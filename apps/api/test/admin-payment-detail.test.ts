import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { adminAuditLog, billingDetails, businesses, payments, platformAdmins, refunds, subscriptions, users } from '@outletbooking/db';
import type { PlanPaymentDetail, PlanPaymentsResponse, RecordBankTransferResult, RecordPlanRefundResult } from '@outletbooking/shared';
import { getReport } from '../src/services/reports';
import { createTestContext, signupInput } from './helpers';

/** I24 · Plan payment detail: double-payment warning, receipt, refunds. */
const ctx = createTestContext();
const DAY = 24 * 3_600_000;

let support = '';
let supportId = 0;
let owner = '';
const ids: Record<string, number> = {};

const subOf = async (businessId: number) => (await ctx.db.select().from(subscriptions).where(eq(subscriptions.businessId, businessId)))[0]!;
const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());

async function makeAdmin(name: string, email: string) {
  const id = await ctx.createUser(name, email);
  await ctx.db.insert(platformAdmins).values({ userId: id, role: 'support' });
  const cookie = await ctx.login(email, 'password123');
  await ctx.db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, id));
  return { id, cookie };
}

/** Records a bank transfer through the API, so there is a real paid payment with a receipt. */
async function paid(over: Record<string, unknown> = {}) {
  const res = await ctx.send('POST', '/admin/payments/bank-transfer', support, {
    businessId: ids.arena,
    plan: 'business',
    amountSen: 9900,
    bankRef: `IN-${Math.random().toString(36).slice(2, 10)}`,
    reason: 'Slip checked in statement',
    ...over,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as RecordBankTransferResult).payment;
}
const detail = async (ref: string) => {
  const res = await ctx.get(`/admin/payments/${ref}`, support);
  expect(res.status).toBe(200);
  return (await res.json()) as PlanPaymentDetail;
};
const refund = (ref: string, over: Record<string, unknown> = {}, cookie = support) =>
  ctx.send('POST', `/admin/payments/${ref}/refund`, cookie, {
    amountSen: 9900,
    reasonCode: 'charged_twice',
    bankRef: `OUT-${Math.random().toString(36).slice(2, 10)}`,
    paidOn: today(),
    planAfter: 'keep',
    reason: 'Paid twice by mistake, refunded by bank transfer',
    ...over,
  });

beforeAll(async () => {
  await ctx.reset();
  for (const [key, name] of [['arena', 'Smash Arena'], ['other', 'Futsal Hub']] as const) {
    const res = await ctx.post('/signup', signupInput({ email: `${key}@example.com`, slug: `det-${key}`, businessName: name, phone: key === 'arena' ? '+60121110011' : '+60121110012' }));
    expect(res.status).toBe(201);
    ids[key] = (await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, `det-${key}`)))[0]!.id;
  }
  owner = await ctx.login('arena@example.com', 'password123');
  const a = await makeAdmin('Nurul Support', 'nurul2@ftech.my');
  support = a.cookie;
  supportId = a.id;
});

beforeEach(async () => {
  await ctx.db.delete(refunds);
  await ctx.db.delete(payments);
  await ctx.db.delete(adminAuditLog);
  await ctx.db.delete(billingDetails);
  ctx.outbox.length = 0;
  for (const id of [ids.arena!, ids.other!]) {
    await ctx.db
      .update(subscriptions)
      .set({ plan: 'trial', status: 'trialing', trialEndsAt: new Date(Date.now() + 3 * DAY), currentPeriodStart: null, currentPeriodEnd: null, freeUntil: null })
      .where(eq(subscriptions.businessId, id));
  }
});

afterAll(() => ctx.close());

describe('access and lookup', () => {
  it('is for platform admins; a business owner and a stranger get nothing', async () => {
    const p = await paid();
    expect((await ctx.get(`/admin/payments/${p.ref}`)).status).toBe(401);
    expect((await ctx.get(`/admin/payments/${p.ref}`, owner)).status).toBe(403);
    expect((await ctx.get(`/admin/payments/${p.ref}/receipt.pdf`, owner)).status).toBe(403);
    expect((await refund(p.ref, {}, owner)).status).toBe(403);
    expect((await ctx.send('POST', `/admin/payments/${p.ref}/resend-receipt`, owner, { reason: 'please' })).status).toBe(403);
    expect((await ctx.get('/admin/payments/OBM_NOPE0000', support)).status).toBe(404);
    expect((await refund('OBM_NOPE0000')).status).toBe(404);
  });

  it('keeps the export route working next to /:ref', async () => {
    expect((await ctx.get('/admin/payments/export', support)).headers.get('content-type')).toContain('text/csv');
  });
});

describe('detail', () => {
  it('shows the payment, the period, the plan today and nothing to warn about', async () => {
    const p = await paid();
    const d = await detail(p.ref);
    expect(d.payment).toMatchObject({ ref: p.ref, status: 'paid', amountSen: 9900, businessName: 'Smash Arena', manual: true });
    expect(d).toMatchObject({ businessSlug: 'det-arena', refunds: [], refundedSen: 0, refundableSen: 9900, possibleDouble: [] });
    expect(d.periodStart).toBeTruthy();
    expect(new Date(d.periodEnd!).getTime()).toBeGreaterThan(new Date(d.periodStart!).getTime());
    expect(d.subscription).toMatchObject({ plan: 'business', status: 'active' });
  });

  it('warns about a possible double payment: same business, same amount, close together', async () => {
    const first = await paid();
    const second = await paid();
    const d = await detail(second.ref);
    expect(d.possibleDouble.map((x) => x.ref)).toEqual([first.ref]);
    expect(d.possibleDouble[0]!.receiptNo).toBe(first.receiptNo);
    expect((await detail(first.ref)).possibleDouble.map((x) => x.ref)).toEqual([second.ref]);
  });

  it('no warning for a different amount, a different business, or payments far apart', async () => {
    const a = await paid();
    await paid({ amountSen: 4900, plan: 'starter' });
    await paid({ businessId: ids.other });
    expect((await detail(a.ref)).possibleDouble).toEqual([]);
    await ctx.db.update(payments).set({ paidAt: new Date(Date.now() - 3 * 3_600_000) }).where(eq(payments.billCode, a.ref));
    await paid();
    expect((await detail(a.ref)).possibleDouble).toEqual([]);
  });

  it('downloads the receipt PDF', async () => {
    const p = await paid();
    const res = await ctx.get(`/admin/payments/${p.ref}/receipt.pdf`, support);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain(`${p.receiptNo}.pdf`);
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('resend receipt', () => {
  it('emails the receipt again and logs it with a reason', async () => {
    const p = await paid();
    ctx.outbox.length = 0;
    const res = await ctx.send('POST', `/admin/payments/${p.ref}/resend-receipt`, support, { reason: 'Owner lost the email' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sentTo: 'arena@example.com' });
    const mail = ctx.outbox.find((m) => m.to === 'arena@example.com');
    expect(mail?.attachments?.[0]?.filename).toBe(`${p.receiptNo}.pdf`);
    const logs = await ctx.db.select().from(adminAuditLog);
    expect(logs.at(-1)).toMatchObject({ action: 'resend_link', reason: 'Owner lost the email', adminUserId: supportId });
    expect(logs.at(-1)!.details).toMatchObject({ link: 'receipt', ref: p.ref });
  });

  it('needs a reason and a paid payment', async () => {
    const p = await paid();
    expect((await ctx.send('POST', `/admin/payments/${p.ref}/resend-receipt`, support, { reason: '' })).status).toBe(400);
    await refund(p.ref);
    const res = await ctx.send('POST', `/admin/payments/${p.ref}/resend-receipt`, support, { reason: 'try anyway' });
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe('not_paid');
  });
});

describe('record a refund', () => {
  it('full refund: marks it refunded, emails the owner with the original receipt number, audits it', async () => {
    const p = await paid();
    ctx.outbox.length = 0;
    const res = await refund(p.ref, { bankRef: 'REF-OUT-1', paidOn: today() });
    expect(res.status).toBe(201);
    const body = (await res.json()) as RecordPlanRefundResult;
    expect(body.refundEmailed).toBe(true);
    expect(body.detail.payment.status).toBe('refunded');
    expect(body.detail).toMatchObject({ refundedSen: 9900, refundableSen: 0 });
    expect(body.detail.refunds[0]).toMatchObject({ amountSen: 9900, reasonCode: 'charged_twice', bankRef: 'REF-OUT-1', recordedBy: 'Nurul Support' });

    const mail = ctx.outbox.find((m) => m.to === 'arena@example.com');
    expect(mail?.subject).toBe(`Refund for receipt ${p.receiptNo} — OutletBooking`);
    expect(mail?.text ?? '').toContain('RM 99.00');

    const [row] = await ctx.db.select().from(refunds);
    expect(row).toMatchObject({ businessId: ids.arena, bookingId: null, method: 'bank_transfer', recordedByUserId: supportId });
    const log = (await ctx.db.select().from(adminAuditLog)).find((l) => l.action === 'record_refund')!;
    expect(log).toMatchObject({ businessId: ids.arena, adminUserId: supportId });
    expect(log.details).toMatchObject({ ref: p.ref, receiptNo: p.receiptNo, amountSen: 9900, bankRef: 'REF-OUT-1', planAfter: 'keep', full: true });

    // Keep period: the plan is untouched.
    expect(await subOf(ids.arena!)).toMatchObject({ plan: 'business', status: 'active' });
    // The list shows it as Refunded.
    const list = (await (await ctx.get('/admin/payments?filter=paid', support)).json()) as PlanPaymentsResponse;
    expect(list.payments.find((x) => x.ref === p.ref)?.status).toBe('refunded');
  });

  it('"End plan now" stops access at once', async () => {
    const p = await paid();
    expect((await refund(p.ref, { planAfter: 'end_now' })).status).toBe(201);
    const sub = await subOf(ids.arena!);
    expect(sub.status).toBe('cancelled');
    expect(sub.currentPeriodEnd!.getTime()).toBeLessThanOrEqual(Date.now());
    expect((await ctx.get('/me', owner)).status).toBe(200);
    const me = (await (await ctx.get('/me', owner)).json()) as { subscription: { hasAccess: boolean } };
    expect(me.subscription.hasAccess).toBe(false);
  });

  it('part refund keeps it paid; the rest can follow, and never more than was paid', async () => {
    const p = await paid();
    const first = await refund(p.ref, { amountSen: 3000, reasonCode: 'other' });
    expect(first.status).toBe(201);
    const afterFirst = ((await first.json()) as RecordPlanRefundResult).detail;
    expect(afterFirst.payment.status).toBe('paid');
    expect(afterFirst).toMatchObject({ refundedSen: 3000, refundableSen: 6900 });

    const tooMuch = await refund(p.ref, { amountSen: 7000 });
    expect(tooMuch.status).toBe(409);
    expect(await errCode(tooMuch)).toBe('refund_too_large');

    const rest = await refund(p.ref, { amountSen: 6900 });
    expect(rest.status).toBe(201);
    expect(((await rest.json()) as RecordPlanRefundResult).detail.payment.status).toBe('refunded');

    const again = await refund(p.ref, { amountSen: 100 });
    expect(again.status).toBe(409);
    expect(await errCode(again)).toBe('not_paid');
  });

  it('refuses the same refund bank reference twice (any letter case) and a payment that was never paid', async () => {
    const a = await paid();
    const b = await paid({ businessId: ids.other });
    expect((await refund(a.ref, { bankRef: 'SAME-REF' })).status).toBe(201);
    const dup = await refund(b.ref, { bankRef: 'same-ref' });
    expect(dup.status).toBe(409);
    expect(await errCode(dup)).toBe('duplicate_reference');
    expect((await detail(b.ref)).payment.status).toBe('paid');

    const [sub] = await ctx.db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.businessId, ids.other!));
    await ctx.db.insert(payments).values({
      businessId: ids.other!,
      subscriptionId: sub!.id,
      purpose: 'subscription',
      billCode: 'tb-unpaid1',
      amountSen: 4900,
      status: 'pending',
      receiptSnapshot: { plan: 'starter', planName: 'Starter' },
    });
    const unpaid = await refund('tb-unpaid1', { amountSen: 4900 });
    expect(unpaid.status).toBe(409);
    expect(await errCode(unpaid)).toBe('not_paid');
  });

  it('checks the form: amount, bank reference, reason, date, reason code, plan choice', async () => {
    const p = await paid();
    for (const bad of [
      { amountSen: 0 },
      { amountSen: 99.5 },
      { bankRef: 'ab' },
      { reason: 'no' },
      { paidOn: 'yesterday' },
      { reasonCode: 'because' },
      { planAfter: 'maybe' },
    ]) {
      expect((await refund(p.ref, bad)).status).toBe(400);
    }
    const future = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(Date.now() + 3 * DAY));
    const res = await refund(p.ref, { paidOn: future });
    expect(res.status).toBe(400);
    expect(await errCode(res)).toBe('future_date');
    expect(await ctx.db.select().from(refunds)).toHaveLength(0);
    expect((await detail(p.ref)).payment.status).toBe('paid');
  });

  it('keeps the refund when the note email fails, and says so', async () => {
    const p = await paid();
    const original = ctx.outbox.push.bind(ctx.outbox);
    ctx.outbox.push = () => {
      throw new Error('mail down');
    };
    const res = await refund(p.ref);
    ctx.outbox.push = original;
    expect(res.status).toBe(201);
    expect(((await res.json()) as RecordPlanRefundResult).refundEmailed).toBe(false);
    expect((await detail(p.ref)).payment.status).toBe('refunded');
  });

  it('income KPI takes refunds off; a business\'s own reports never see FTech\'s refund', async () => {
    const p = await paid();
    const before = (await (await ctx.get('/admin/payments', support)).json()) as PlanPaymentsResponse;
    expect(before.kpis.incomeThisMonthSen).toBe(9900);
    expect((await refund(p.ref, { amountSen: 2500, reasonCode: 'other' })).status).toBe(201);
    const after = (await (await ctx.get('/admin/payments', support)).json()) as PlanPaymentsResponse;
    expect(after.kpis.incomeThisMonthSen).toBe(7400);

    const report = await getReport(ctx.db, ids.arena!, { period: 'month', offset: 0 });
    expect(report.refundedSen).toBe(0);
  });
});
