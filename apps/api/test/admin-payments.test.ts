import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { adminAuditLog, billingDetails, businesses, payments, refunds, platformAdmins, subscriptions, users } from '@outletbooking/db';
import type { PlanPaymentsResponse, RecordBankTransferResult } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

/** I8 · Plan payments: the list, its filters and KPIs, and recording a bank transfer. */
const ctx = createTestContext();
const DAY = 24 * 3_600_000;
const MIN = 60_000;

let support = '';
let superAdmin = '';
let supportId = 0;
let owner = '';
const ids: Record<string, number> = {};

const subOf = async (businessId: number) => (await ctx.db.select().from(subscriptions).where(eq(subscriptions.businessId, businessId)))[0]!;
const setSub = (businessId: number, values: Partial<typeof subscriptions.$inferInsert>) =>
  ctx.db.update(subscriptions).set(values).where(eq(subscriptions.businessId, businessId));
const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const list = async (qs = '', cookie = support) => {
  const res = await ctx.get(`/admin/payments${qs}`, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as PlanPaymentsResponse;
};
const refs = (r: PlanPaymentsResponse) => r.payments.map((p) => p.providerRef);
const transfer = (over: Record<string, unknown> = {}, cookie = support) =>
  ctx.send('POST', '/admin/payments/bank-transfer', cookie, {
    businessId: ids.arena,
    plan: 'business',
    amountSen: 9900,
    bankRef: 'MBB-123456',
    reason: 'Slip checked in Maybank statement',
    ...over,
  });

async function makeAdmin(name: string, email: string, role: 'support' | 'super_admin') {
  const id = await ctx.createUser(name, email);
  await ctx.db.insert(platformAdmins).values({ userId: id, role });
  const cookie = await ctx.login(email, 'password123');
  // /admin needs two-step sign-in turned on (after the sign-in here); the real flow is tested in admin-sign-in.test.ts.
  await ctx.db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, id));
  return { id, cookie };
}

/** A plan payment row as the website would leave it. */
const addPayment = async (businessId: number, over: Partial<typeof payments.$inferInsert> = {}) => {
  const [sub] = await ctx.db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.businessId, businessId));
  const [row] = await ctx.db
    .insert(payments)
    .values({
      businessId,
      subscriptionId: sub!.id,
      purpose: 'subscription',
      provider: 'toyyibpay',
      billCode: `tb-${Math.random().toString(36).slice(2, 10)}`,
      amountSen: 4900,
      status: 'pending',
      receiptSnapshot: { plan: 'starter', planName: 'Starter', companyName: 'X' },
      ...over,
    })
    .returning();
  return row!;
};

beforeAll(async () => {
  await ctx.reset();
  for (const [key, name] of [['arena', 'Smash Arena'], ['other', 'Futsal Hub']] as const) {
    const res = await ctx.post('/signup', signupInput({ email: `${key}@example.com`, slug: `pay-${key}`, businessName: name, phone: key === 'arena' ? '+60121110001' : '+60121110002' }));
    expect(res.status).toBe(201);
    ids[key] = (await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, `pay-${key}`)))[0]!.id;
  }
  owner = await ctx.login('arena@example.com', 'password123');
  const s = await makeAdmin('Nurul Support', 'nurul@ftech.my', 'support');
  support = s.cookie;
  supportId = s.id;
  superAdmin = (await makeAdmin('Fadhil Super', 'fadhil@ftech.my', 'super_admin')).cookie;
});

beforeEach(async () => {
  await ctx.db.delete(refunds);
  await ctx.db.delete(payments);
  await ctx.db.delete(adminAuditLog);
  await ctx.db.delete(billingDetails);
  ctx.outbox.length = 0;
  for (const id of [ids.arena!, ids.other!]) {
    await setSub(id, { plan: 'trial', status: 'trialing', trialEndsAt: new Date(Date.now() + 3 * DAY), currentPeriodStart: null, currentPeriodEnd: null, freeUntil: null });
  }
});

afterAll(() => ctx.close());

describe('access', () => {
  it('is for platform admins only, but any admin role', async () => {
    expect((await ctx.get('/admin/payments')).status).toBe(401);
    expect((await ctx.get('/admin/payments', owner)).status).toBe(403);
    expect((await ctx.send('POST', '/admin/payments/bank-transfer', owner, { businessId: ids.arena })).status).toBe(403);
    expect((await ctx.get('/admin/payments/export', owner)).status).toBe(403);
    expect((await ctx.get('/admin/payments', support)).status).toBe(200);
    expect((await ctx.get('/admin/payments', superAdmin)).status).toBe(200);
  });
});

describe('list, filters and KPIs', () => {
  it('shows each kind of plan payment with the right status', async () => {
    const paid = await addPayment(ids.arena!, { status: 'paid', paidAt: new Date(), method: 'fpx', receiptNo: 'OB-2026-000001', amountSen: 9900 });
    const failed = await addPayment(ids.other!, { status: 'failed' });
    const young = await addPayment(ids.other!, { status: 'pending' });
    const old = await addPayment(ids.arena!, { status: 'pending', createdAt: new Date(Date.now() - 2 * 3_600_000) });
    const r = await list();
    const by = (id: number) => r.payments.find((p) => p.id === id)!;
    expect(by(paid.id)).toMatchObject({ status: 'paid', receiptNo: 'OB-2026-000001', method: 'fpx', manual: false, businessName: 'Smash Arena', planName: 'Starter' });
    expect(by(failed.id).status).toBe('not_completed');
    expect(by(young.id).status).toBe('waiting');
    expect(by(old.id).status).toBe('to_check');
    expect(r.payments.map((p) => p.id)).toEqual([old.id, young.id, failed.id, paid.id]); // newest first
  });

  it('filters: paid / not completed / to check / renew soon, and search', async () => {
    const paid = await addPayment(ids.arena!, { status: 'paid', paidAt: new Date(), receiptNo: 'OB-2026-000007', billCode: 'tb-paid1' });
    await addPayment(ids.other!, { status: 'failed', billCode: 'tb-fail1' });
    await addPayment(ids.other!, { status: 'expired', billCode: 'tb-exp1' });
    await addPayment(ids.other!, { status: 'pending', billCode: 'tb-old1', createdAt: new Date(Date.now() - 3_600_000) });
    await addPayment(ids.other!, { status: 'pending', billCode: 'tb-new1' });
    expect(refs(await list('?filter=paid'))).toEqual(['tb-paid1']);
    expect(refs(await list('?filter=not_completed')).sort()).toEqual(['tb-exp1', 'tb-fail1']);
    expect(refs(await list('?filter=to_check'))).toEqual(['tb-old1']);

    // Renew soon: the paying business whose month ends within 7 days, not one that renews later.
    await setSub(ids.arena!, { plan: 'business', status: 'active', currentPeriodEnd: new Date(Date.now() + 3 * DAY) });
    await setSub(ids.other!, { plan: 'starter', status: 'active', currentPeriodEnd: new Date(Date.now() + 20 * DAY) });
    await addPayment(ids.other!, { status: 'paid', paidAt: new Date(), billCode: 'tb-later' });
    expect(refs(await list('?filter=renew_soon'))).toEqual(['tb-paid1']);

    // Search by receipt number, bill code, business name and link.
    expect(refs(await list('?q=000007'))).toEqual(['tb-paid1']);
    expect(refs(await list('?q=tb-fail'))).toEqual(['tb-fail1']);
    expect((await list('?q=smash')).payments.map((p) => p.id)).toEqual([paid.id]);
    expect(refs(await list('?q=pay-other')).length).toBe(5);
    expect(refs(await list('?q=%25'))).toEqual([]); // a percent sign is text, not a wildcard
  });

  it('KPIs: income this month vs the same stretch of last month, not completed, to check, renew soon', async () => {
    await addPayment(ids.arena!, { status: 'paid', paidAt: new Date(), amountSen: 9900 });
    await addPayment(ids.other!, { status: 'paid', paidAt: new Date(Date.now() - 60 * DAY), amountSen: 4900 }); // too old to count
    // Received 4900 and paid it all back: nets to nothing (the refund record is what takes it off).
    const refunded = await addPayment(ids.other!, { status: 'refunded', paidAt: new Date(), amountSen: 4900 });
    await ctx.db.insert(refunds).values({ businessId: ids.other!, paymentId: refunded.id, amountSen: 4900, method: 'bank_transfer', reasonCode: 'charged_twice' });
    await addPayment(ids.other!, { status: 'failed' });
    await addPayment(ids.other!, { status: 'pending', createdAt: new Date(Date.now() - 2 * 3_600_000) });
    await addPayment(ids.other!, { status: 'failed', createdAt: new Date(Date.now() - 45 * DAY) }); // outside 30 days
    await setSub(ids.arena!, { plan: 'business', status: 'active', currentPeriodEnd: new Date(Date.now() + 2 * DAY) });
    const { kpis } = await list();
    expect(kpis).toMatchObject({ incomeThisMonthSen: 9900, notCompleted: 1, toCheck: 1, renewSoon: 1 });
    expect(kpis.incomeVsLastMonthSen).toBeLessThanOrEqual(9900);
  });

  it('pages 50 at a time with beforeId', async () => {
    for (let i = 0; i < 53; i++) await addPayment(ids.other!, { status: 'failed', billCode: `tb-p${i}` });
    const first = await list();
    expect(first.payments).toHaveLength(50);
    expect(first.nextBeforeId).not.toBeNull();
    const second = await list(`?beforeId=${first.nextBeforeId}`);
    expect(second.payments).toHaveLength(3);
    expect(second.nextBeforeId).toBeNull();
    expect(second.payments.every((p) => p.id < first.nextBeforeId!)).toBe(true);
  });

  it('never lists booking payments', async () => {
    // A payment for a booking is not a plan payment; the list only reads purpose = subscription.
    await addPayment(ids.arena!, { status: 'paid', paidAt: new Date() });
    expect((await list()).payments).toHaveLength(1);
  });

  it('exports the filtered list as a spreadsheet-safe CSV', async () => {
    await addPayment(ids.arena!, { status: 'paid', paidAt: new Date(), receiptNo: 'OB-2026-000009', amountSen: 9900, billCode: 'tb-csv1', method: 'fpx' });
    await ctx.db.update(businesses).set({ name: '=HYPERLINK("x")' }).where(eq(businesses.id, ids.other!));
    await addPayment(ids.other!, { status: 'failed', billCode: 'tb-csv2' });
    const res = await ctx.get('/admin/payments/export?filter=all', support);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="outletbooking-plan-payments-\d{4}-\d{2}-\d{2}\.csv"/);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM so Excel reads UTF-8
    const csv = bytes.toString('utf8');
    expect(csv).toContain('Date (Malaysia time),Business,Plan,Amount (RM),Method,Reference,Status,Receipt no,Recorded by');
    expect(csv).toContain('Smash Arena,Starter,99.00,fpx,tb-csv1,paid,OB-2026-000009');
    expect(csv).toContain(`'=HYPERLINK(""x"")`);
    const only = await (await ctx.get('/admin/payments/export?filter=not_completed', support)).text();
    expect(only).toContain('tb-csv2');
    expect(only).not.toContain('tb-csv1');
    await ctx.db.update(businesses).set({ name: 'Futsal Hub' }).where(eq(businesses.id, ids.other!));
  });
});

describe('record a bank transfer', () => {
  it('marks one month paid, starts the plan, numbers the receipt, emails it and writes the audit row', async () => {
    const res = await transfer();
    expect(res.status).toBe(201);
    const body = (await res.json()) as RecordBankTransferResult;
    expect(body.receiptEmailed).toBe(true);
    expect(body.payment).toMatchObject({
      status: 'paid',
      manual: true,
      method: 'bank_transfer',
      amountSen: 9900,
      providerRef: 'MBB-123456',
      recordedBy: 'Nurul Support',
      businessName: 'Smash Arena',
      planName: 'Business',
    });
    expect(body.payment.ref).toMatch(/^OBM_[0-9A-F]{8}$/);
    expect(body.payment.receiptNo).toMatch(/^OB-\d{4}-\d{6}$/);

    // The plan moved on exactly as an online payment would: trial end → one month later.
    const sub = await subOf(ids.arena!);
    expect(sub).toMatchObject({ plan: 'business', status: 'active' });
    expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(sub.trialEndsAt.getTime());

    const [row] = await ctx.db.select().from(payments).where(eq(payments.billCode, body.payment.ref));
    expect(row).toMatchObject({ provider: 'manual', method: 'bank_transfer', recordedByUserId: supportId, status: 'paid', purpose: 'subscription' });

    const mail = ctx.outbox.find((m) => m.to === 'arena@example.com');
    expect(mail?.subject).toContain(body.payment.receiptNo!);
    expect(mail?.attachments?.[0]?.filename).toBe(`${body.payment.receiptNo}.pdf`);

    const [log] = await ctx.db.select().from(adminAuditLog);
    expect(log).toMatchObject({ action: 'record_payment', businessId: ids.arena, adminUserId: supportId, reason: 'Slip checked in Maybank statement' });
    expect(log!.details).toMatchObject({ ref: body.payment.ref, bankRef: 'MBB-123456', plan: 'business', amountSen: 9900 });
  });

  it('shows up in the list and is billed to the receipt details when the owner saved some', async () => {
    await ctx.db.insert(billingDetails).values({ businessId: ids.arena!, companyName: 'Smash Arena Sdn Bhd', receiptEmail: 'accounts@smasharena.my' });
    const body = (await (await transfer()).json()) as RecordBankTransferResult;
    expect(ctx.outbox.some((m) => m.to === 'accounts@smasharena.my')).toBe(true);
    expect(ctx.outbox.some((m) => m.to === 'arena@example.com')).toBe(false);
    expect((await list('?filter=paid')).payments[0]!.id).toBe(body.payment.id);
  });

  it('stacks the month after time already paid', async () => {
    const until = new Date(Date.now() + 10 * DAY);
    await setSub(ids.arena!, { plan: 'starter', status: 'active', currentPeriodEnd: until });
    expect((await transfer()).status).toBe(201);
    const sub = await subOf(ids.arena!);
    expect(sub.plan).toBe('business');
    expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(until.getTime() + 27 * DAY);
  });

  it('works for a trial that already ended (restarts from now)', async () => {
    await setSub(ids.arena!, { plan: 'trial', status: 'expired', trialEndsAt: new Date(Date.now() - 5 * DAY) });
    expect((await transfer()).status).toBe(201);
    const sub = await subOf(ids.arena!);
    expect(sub.status).toBe('active');
    expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now() + 27 * DAY);
  });

  it('refuses the same bank reference twice (any letter case) and changes nothing the second time', async () => {
    expect((await transfer()).status).toBe(201);
    const before = await subOf(ids.arena!);
    const again = await transfer({ businessId: ids.other, bankRef: 'mbb-123456' });
    expect(again.status).toBe(409);
    expect(await errCode(again)).toBe('duplicate_reference');
    expect((await subOf(ids.arena!)).currentPeriodEnd).toEqual(before.currentPeriodEnd);
    expect(await ctx.db.select().from(payments)).toHaveLength(1);
    expect(await ctx.db.select().from(adminAuditLog)).toHaveLength(1);
  });

  it('needs a reason, a bank reference, a real plan and a sensible amount', async () => {
    expect((await transfer({ reason: 'ok' })).status).toBe(400);
    expect((await transfer({ bankRef: '' })).status).toBe(400);
    expect((await transfer({ plan: 'trial' })).status).toBe(400);
    expect((await transfer({ amountSen: 0 })).status).toBe(400);
    expect((await transfer({ amountSen: 99.5 })).status).toBe(400);
    expect((await transfer({ businessId: 999999 })).status).toBe(404);
    expect(await ctx.db.select().from(payments)).toHaveLength(0);
    expect(await ctx.db.select().from(adminAuditLog)).toHaveLength(0);
  });

  it('refuses a deleted business', async () => {
    await ctx.db.update(businesses).set({ deletedAt: new Date() }).where(eq(businesses.id, ids.other!));
    expect((await transfer({ businessId: ids.other, bankRef: 'DEL-1' })).status).toBe(404);
    await ctx.db.update(businesses).set({ deletedAt: null }).where(eq(businesses.id, ids.other!));
  });

  it('keeps the payment when the receipt email fails, and says so', async () => {
    const original = ctx.outbox.push.bind(ctx.outbox);
    // The test mailer records every message; make this one send throw by pointing the receipt at nothing.
    await ctx.db.insert(billingDetails).values({ businessId: ids.arena!, companyName: 'X', receiptEmail: 'x@example.com' });
    ctx.outbox.push = () => {
      throw new Error('mail down');
    };
    const res = await transfer({ bankRef: 'MAIL-DOWN-1' });
    ctx.outbox.push = original;
    expect(res.status).toBe(201);
    const body = (await res.json()) as RecordBankTransferResult;
    expect(body.receiptEmailed).toBe(false);
    expect((await subOf(ids.arena!)).status).toBe('active');
  });
});
