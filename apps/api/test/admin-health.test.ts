import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { adminAuditLog, businesses, emailEvents, paymentChecks, payments, platformAdmins, subscriptions, users } from '@outletbooking/db';
import type { CheckoutResult, PaymentCheckItem, RecheckResult, SystemHealth } from '@outletbooking/shared';
import { settleBackground } from '../src/background';
import { trackMail, maskEmail } from '../src/services/mail-tracking';
import { scanPendingPayments } from '../src/services/payment-checks';
import { verifySvixSignature } from '../src/services/resend-webhook';
import { createTestContext, signupInput } from './helpers';

/** I27 · System health: payments to check, failed jobs, email problems (Resend webhook). Every admin can use it. */
const SECRET_BYTES = 'test-webhook-secret-0123456789';
const WEBHOOK_SECRET = `whsec_${Buffer.from(SECRET_BYTES).toString('base64')}`;
const ctx = createTestContext({
  PLATFORM_TOYYIBPAY_SECRET_KEY: 'platform-secret',
  PLATFORM_TOYYIBPAY_CATEGORY_CODE: 'platcat',
  RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET,
});
const MIN = 60_000;

let owner = '';
let nurul = ''; // support admin
let nurulId = 0;
let bizId = 0;
let ownerId = 0;

const json = async <T>(res: Response, status = 200): Promise<T> => {
  expect(res.status).toBe(status);
  return (await res.json()) as T;
};
const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const health = async () => json<SystemHealth>(await ctx.get('/admin/health', nurul));
const details = { companyName: 'Smash Arena Sdn Bhd', receiptEmail: 'accounts@smasharena.my' };
const startCheckout = async () => (await json<CheckoutResult>(await ctx.send('POST', '/billing/checkout', owner, { plan: 'starter', details }), 201)).ref;
const planCallback = (billcode: string, extra: Record<string, string> = {}) =>
  ctx.app.request('/toyyibpay/plan-callback', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ status_id: '1', billcode, order_id: 'OBP_TEST', refno: 'TPREF1', ...extra }),
  });
const paymentOf = async (bill: string) => (await ctx.db.select().from(payments).where(eq(payments.billCode, bill)))[0]!;
const checkAudit = async () => (await ctx.db.select().from(adminAuditLog).orderBy(adminAuditLog.id)).filter((a) => a.action === 'recheck_payment');
const deps = () => ({ db: ctx.db, env: ctx.env, toyyibpay: ctx.toyyibpay, push: { send: async (m: unknown[]) => m.map(() => ({ status: 'ok' as const, id: 'x' })) }, mailer: { send: async () => undefined } });

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'owner@example.com', slug: 'health-biz', businessName: 'Smash Arena PJ' }))).status).toBe(201);
  owner = await ctx.login('owner@example.com', 'password123');
  bizId = (await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'health-biz')))[0]!.id;
  ownerId = (await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, 'owner@example.com')))[0]!.id;
  nurulId = await ctx.createUser('Nurul A', 'nurul@ftech.my');
  await ctx.db.insert(platformAdmins).values({ userId: nurulId, role: 'support', isActive: true });
  nurul = await ctx.login('nurul@ftech.my', 'password123');
  await ctx.db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, nurulId));
});

beforeEach(async () => {
  await ctx.db.delete(paymentChecks);
  await ctx.db.delete(emailEvents);
  await ctx.db.delete(adminAuditLog);
  await ctx.db.execute(sql`delete from payments`);
  ctx.jobs.failed.length = 0;
  ctx.jobs.retried.length = 0;
  await ctx.db.update(subscriptions).set({ status: 'trialing', plan: 'trial', currentPeriodEnd: null }).where(eq(subscriptions.businessId, bizId));
});

afterAll(() => ctx.close());

describe('access and tiles', () => {
  it('needs an admin session; a Support admin can read it', async () => {
    expect((await ctx.get('/admin/health')).status).toBe(401);
    expect((await ctx.get('/admin/health', owner)).status).toBe(403);
    expect((await ctx.get('/admin/health', nurul)).status).toBe(200);
    expect((await ctx.send('POST', '/admin/health/payments/1/recheck', owner)).status).toBe(403);
  });

  it('is green with nothing to look at, and says why a tile is off', async () => {
    const h = await health();
    expect(h.database.light).toBe('ok');
    expect(h.api.light).toBe('ok');
    expect(h.toyyibpay).toMatchObject({ light: 'ok', count: 0 });
    expect(h.paymentChecks).toEqual([]);
    expect(h.failedJobs).toEqual([]);
    expect(h.emailProblems).toEqual([]);
    // The test server runs without jobs, prints email to the log and has no Expo token.
    expect(h.jobs).toMatchObject({ light: 'off', note: 'jobs_off' });
    expect(h.email).toMatchObject({ light: 'off', note: 'console' });
    expect(h.push).toMatchObject({ light: 'off', note: 'no_token' });
  });
});

describe('payments to check', () => {
  it('a callback that says paid while ToyyibPay does not opens one check (never a second), without customer details', async () => {
    const bill = await startCheckout();
    expect((await planCallback(bill)).status).toBe(200);
    expect((await planCallback(bill)).status).toBe(200);
    const h = await health();
    expect(h.toyyibpay).toMatchObject({ light: 'warn', count: 1 });
    expect(h.paymentChecks).toHaveLength(1);
    expect(h.paymentChecks[0]).toMatchObject({
      problem: 'callback_recheck_mismatch',
      callbackStatus: 'paid',
      recheckStatus: 'pending',
      kind: 'plan',
      bookingRef: null,
      billCode: bill,
      amountSen: 4900,
      business: { id: bizId, name: 'Smash Arena PJ' },
    });
    expect(JSON.stringify(h.paymentChecks)).not.toMatch(/owner@example|accounts@smasharena|Ali Hassan/);
  });

  it('a callback that agrees leaves nothing to check, and a failed callback is not a problem', async () => {
    const paid = await startCheckout();
    ctx.toyyibpay.pay(paid);
    await planCallback(paid);
    const failedBill = await startCheckout();
    await planCallback(failedBill, { status_id: '3' });
    expect((await health()).paymentChecks).toEqual([]);
  });

  it('a payment that is short of the amount is flagged with what ToyyibPay said', async () => {
    const bill = await startCheckout();
    ctx.toyyibpay.pay(bill, 100); // RM 1.00 of RM 49.00
    await planCallback(bill);
    const [item] = (await health()).paymentChecks;
    expect(item).toMatchObject({ problem: 'callback_recheck_mismatch', recheckStatus: 'Paid RM 1.00, expected RM 49.00' });
    expect((await paymentOf(bill)).status).toBe('pending'); // never marked paid
  });

  it('"Re-check now" with ToyyibPay still saying pending keeps the check and logs it', async () => {
    const bill = await startCheckout();
    await planCallback(bill);
    const [item] = (await health()).paymentChecks as [PaymentCheckItem];
    const result = await json<RecheckResult>(await ctx.send('POST', `/admin/health/payments/${item.id}/recheck`, nurul));
    expect(result).toEqual({ outcome: 'still_pending', resolved: false });
    expect((await health()).paymentChecks).toHaveLength(1);
    const audit = await checkAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.adminUserId).toBe(nurulId);
    expect(audit[0]!.reason).toBe(`Payment check #${item.id} · bill ${bill} · ToyyibPay says pending`);
  });

  it('"Re-check now" applies a payment ToyyibPay now says is paid, and the check closes', async () => {
    const bill = await startCheckout();
    await planCallback(bill);
    const [item] = (await health()).paymentChecks as [PaymentCheckItem];
    ctx.toyyibpay.pay(bill);
    const result = await json<RecheckResult>(await ctx.send('POST', `/admin/health/payments/${item.id}/recheck`, nurul));
    await settleBackground();
    expect(result).toEqual({ outcome: 'paid', resolved: true });
    const payment = await paymentOf(bill);
    expect(payment.status).toBe('paid');
    expect(payment.receiptNo).toMatch(/^OB-\d{4}-\d{6}$/);
    expect((await ctx.db.select().from(subscriptions).where(eq(subscriptions.businessId, bizId)))[0]).toMatchObject({ plan: 'starter', status: 'active' });
    expect((await health()).paymentChecks).toEqual([]);
    const [row] = await ctx.db.select().from(paymentChecks).where(eq(paymentChecks.id, item.id));
    expect(row!.resolvedByUserId).toBe(nurulId);
  });

  it('a check closes by itself when the payment is paid some other way', async () => {
    const bill = await startCheckout();
    await planCallback(bill);
    expect((await health()).paymentChecks).toHaveLength(1);
    ctx.toyyibpay.pay(bill);
    await planCallback(bill); // the real callback finally arrives
    expect((await health()).paymentChecks).toEqual([]);
    const [row] = await ctx.db.select().from(paymentChecks);
    expect(row!.resolvedAt).not.toBeNull();
    expect(row!.resolvedByUserId).toBeNull();
  });

  it('when ToyyibPay cannot be reached the re-check says so and a "re-check failed" check is kept', async () => {
    const bill = await startCheckout();
    await planCallback(bill);
    const [item] = (await health()).paymentChecks as [PaymentCheckItem];
    const original = ctx.toyyibpay.getBillTransactions;
    ctx.toyyibpay.getBillTransactions = async () => {
      throw new Error('ToyyibPay is down');
    };
    try {
      const result = await json<RecheckResult>(await ctx.send('POST', `/admin/health/payments/${item.id}/recheck`, nurul));
      expect(result).toEqual({ outcome: 'error', resolved: false });
      const problems = (await health()).paymentChecks.map((c) => c.problem).sort();
      expect(problems).toEqual(['callback_recheck_mismatch', 'recheck_failed']);
    } finally {
      ctx.toyyibpay.getBillTransactions = original;
    }
  });

  it('can be closed with a reason, and unknown checks are 404', async () => {
    const bill = await startCheckout();
    await planCallback(bill);
    const [item] = (await health()).paymentChecks as [PaymentCheckItem];
    expect((await ctx.send('POST', `/admin/health/payments/${item.id}/close`, nurul, { reason: 'x' })).status).toBe(400);
    expect((await ctx.send('POST', `/admin/health/payments/${item.id}/close`, nurul, { reason: 'Customer never paid, confirmed with the owner' })).status).toBe(204);
    expect((await health()).paymentChecks).toEqual([]);
    expect((await checkAudit()).at(-1)!.reason).toContain('closed: Customer never paid');
    expect((await ctx.send('POST', '/admin/health/payments/99999/recheck', nurul)).status).toBe(404);
  });
});

describe('the pending-payment scan', () => {
  const ageBill = (bill: string, minutes: number) =>
    ctx.db.update(payments).set({ createdAt: new Date(Date.now() - minutes * MIN) }).where(eq(payments.billCode, bill));

  it('applies a bill ToyyibPay says is paid but never called back about, and leaves unpaid and out-of-window bills alone', async () => {
    const lost = await startCheckout();
    ctx.toyyibpay.pay(lost);
    await ageBill(lost, 45);
    const unpaid = await startCheckout();
    await ageBill(unpaid, 45);
    const tooNew = await startCheckout();
    ctx.toyyibpay.pay(tooNew);
    await ageBill(tooNew, 10);
    const tooOld = await startCheckout();
    ctx.toyyibpay.pay(tooOld);
    await ageBill(tooOld, 3 * 60);

    const r = await scanPendingPayments(deps());
    await settleBackground();
    expect(r).toEqual({ checked: 2, applied: 1 });
    expect((await paymentOf(lost)).status).toBe('paid');
    expect((await paymentOf(unpaid)).status).toBe('pending');
    expect((await paymentOf(tooNew)).status).toBe('pending');
    expect((await paymentOf(tooOld)).status).toBe('pending');
    // The missing callback is kept in the history, already closed.
    const [row] = await ctx.db.select().from(paymentChecks);
    expect(row).toMatchObject({ problem: 'no_callback', recheckStatus: 'paid' });
    expect(row!.resolvedAt).not.toBeNull();
    expect((await health()).paymentChecks).toEqual([]);
  });

  it('opens a "re-check failed" check when ToyyibPay cannot be reached, and does not ask again while it is open', async () => {
    const bill = await startCheckout();
    await ageBill(bill, 45);
    const original = ctx.toyyibpay.getBillTransactions;
    let calls = 0;
    ctx.toyyibpay.getBillTransactions = async () => {
      calls++;
      throw new Error('ToyyibPay is down');
    };
    try {
      await scanPendingPayments(deps());
      await scanPendingPayments(deps());
    } finally {
      ctx.toyyibpay.getBillTransactions = original;
    }
    expect(calls).toBe(1); // the second run does not ask again: the open check is already in front of a person
    const open = await ctx.db.select().from(paymentChecks);
    expect(open.filter((c) => c.problem === 'recheck_failed' && c.resolvedAt === null)).toHaveLength(1);
  });
});

describe('failed background jobs', () => {
  it('lists the last week’s failed jobs, and retry puts one back', async () => {
    const id = '6b0f5d5e-8c6e-4a58-9b6e-0f6e2f4c9a11';
    ctx.jobs.failed.push(
      { id, name: 'expire-pending-bookings', error: 'Timeout talking to database', tries: 3, maxTries: 3, failedAt: new Date().toISOString() },
      { id: '11111111-1111-4111-8111-111111111111', name: 'trial-reminders', error: 'old one', tries: 3, maxTries: 3, failedAt: new Date(Date.now() - 10 * 24 * 60 * MIN).toISOString() },
    );
    const h = await health();
    expect(h.failedJobs.map((j) => j.id)).toEqual([id]);
    expect(h.jobs).toMatchObject({ count: 1 }); // jobs are off in this server, but the count is still the truth
    expect((await ctx.send('POST', `/admin/health/jobs/expire-pending-bookings/${id}/retry`, nurul)).status).toBe(204);
    expect(ctx.jobs.retried).toEqual([{ name: 'expire-pending-bookings', id }]);
    expect((await health()).failedJobs).toEqual([]);
    expect((await ctx.send('POST', `/admin/health/jobs/expire-pending-bookings/${id}/retry`, nurul)).status).toBe(404);
    expect((await ctx.send('POST', '/admin/health/jobs/x/not-a-uuid/retry', nurul)).status).toBe(400);
    expect((await ctx.send('POST', `/admin/health/jobs/x/${id}/retry`, owner)).status).toBe(403);
  });
});

describe('email delivery problems', () => {
  const sign = (body: string, over: { id?: string; timestamp?: string; secretBytes?: string } = {}) => {
    const id = over.id ?? 'msg_1';
    const timestamp = over.timestamp ?? String(Math.floor(Date.now() / 1000));
    const key = Buffer.from(over.secretBytes ?? SECRET_BYTES);
    const sig = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
    return { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${sig}` };
  };
  const hook = (event: unknown, headers?: Record<string, string>) => {
    const body = JSON.stringify(event);
    return ctx.app.request('/webhooks/resend', { method: 'POST', headers: { 'content-type': 'application/json', ...(headers ?? sign(body)) }, body });
  };
  const seed = async (providerId: string, template = 'receipt', status = 'sent') =>
    ctx.db.insert(emailEvents).values({ businessId: bizId, template, toMasked: 'a***@semakauto.my', providerMessageId: providerId, status });
  const statusOf = async (providerId: string) => (await ctx.db.select().from(emailEvents).where(eq(emailEvents.providerMessageId, providerId)))[0]!;

  it('only accepts a message Resend signed, fresh, with our secret', async () => {
    await seed('re_1');
    const event = { type: 'email.bounced', data: { email_id: 're_1' } };
    expect((await hook(event, { 'svix-id': 'x', 'svix-timestamp': '1', 'svix-signature': 'v1,abc' })).status).toBe(401);
    expect((await hook(event, sign(JSON.stringify(event), { secretBytes: 'someone-else' }))).status).toBe(401);
    expect((await hook(event, sign(JSON.stringify(event), { timestamp: String(Math.floor(Date.now() / 1000) - 3600) }))).status).toBe(401);
    expect((await hook(event, {})).status).toBe(401);
    expect((await statusOf('re_1')).status).toBe('sent');
    expect((await hook(event)).status).toBe(200);
    expect((await statusOf('re_1')).status).toBe('bounced');
  });

  it('is off (503) when no webhook secret is set', async () => {
    const off = createTestContext();
    try {
      expect((await off.app.request('/webhooks/resend', { method: 'POST', body: '{}' })).status).toBe(503);
    } finally {
      await off.close();
    }
  });

  it('turns bounces, spam reports and failures into problems on the page, with the reason; delivered ones are not problems', async () => {
    await seed('re_ok', 'receipt');
    await seed('re_bounce', 'receipt');
    await seed('re_spam', 'announcement');
    await seed('re_fail', 'trial_ending');
    await hook({ type: 'email.delivered', data: { email_id: 're_ok' } });
    await hook({ type: 'email.bounced', data: { email_id: 're_bounce', bounce: { message: 'The mailbox does not exist' } } });
    await hook({ type: 'email.complained', data: { email_id: 're_spam' } });
    await hook({ type: 'email.failed', data: { email_id: 're_fail', reason: 'Quota exceeded' } });
    await hook({ type: 'email.opened', data: { email_id: 're_ok' } }); // ignored
    const h = await health();
    expect(h.emailProblems.map((p) => [p.template, p.status, p.detail]).sort()).toEqual(
      [
        ['announcement', 'complained', null],
        ['receipt', 'bounced', 'The mailbox does not exist'],
        ['trial_ending', 'failed', 'Quota exceeded'],
      ].sort(),
    );
    expect(h.emailProblems[0]!.business).toEqual({ id: bizId, name: 'Smash Arena PJ' });
    expect(h.emailProblems.every((p) => p.toMasked === 'a***@semakauto.my')).toBe(true);
    expect(h.email).toMatchObject({ light: 'warn', count: 3 });
  });

  it('a late "delivered" never hides a bounce, an unknown message is fine, and old problems drop off', async () => {
    await seed('re_b');
    await hook({ type: 'email.bounced', data: { email_id: 're_b' } });
    await hook({ type: 'email.delivered', data: { email_id: 're_b' } });
    expect((await statusOf('re_b')).status).toBe('bounced');
    expect((await hook({ type: 'email.bounced', data: { email_id: 're_unknown' } })).status).toBe(200);
    expect((await health()).emailProblems).toHaveLength(1);
    // A problem older than a week is no longer shown (inserted with an old date: updated rows get a fresh one).
    await ctx.db.delete(emailEvents);
    await ctx.db.insert(emailEvents).values({ businessId: bizId, template: 'receipt', toMasked: 'a***@x.my', providerMessageId: 're_old', status: 'bounced', updatedAt: new Date(Date.now() - 10 * 24 * 60 * MIN) });
    expect((await health()).emailProblems).toEqual([]);
  });

  it('verifySvixSignature accepts several signatures and rejects a wrong length', () => {
    const body = '{"a":1}';
    const ts = String(Math.floor(Date.now() / 1000));
    const good = createHmac('sha256', Buffer.from(SECRET_BYTES)).update(`i.${ts}.${body}`).digest('base64');
    const headers = (signature: string) => ({ id: 'i', timestamp: ts, signature });
    expect(verifySvixSignature(WEBHOOK_SECRET, headers(`v1,bogus v1,${good}`), body)).toBe(true);
    expect(verifySvixSignature(WEBHOOK_SECRET, headers(`v2,${good}`), body)).toBe(false);
    expect(verifySvixSignature(WEBHOOK_SECRET, headers('v1,AAAA'), body)).toBe(false);
    expect(verifySvixSignature(WEBHOOK_SECRET, headers(`v1,${good}`), body + ' ')).toBe(false);
  });
});

describe('email tracking', () => {
  it('records a masked address, the template, the business and Resend’s id; a failure is recorded and still thrown', async () => {
    const sent: string[] = [];
    const inner = { send: async (m: { to: string }) => (sent.push(m.to), { providerId: 're_abc' }) };
    const mailer = trackMail(ctx.db, inner);
    await mailer.send({ to: 'owner@example.com', subject: 's', text: 't', meta: { template: 'sign_in_link', userId: ownerId } });
    await mailer.send({ to: 'x@example.com', subject: 's', text: 't' }); // no meta: not tracked
    const rows = await ctx.db.select().from(emailEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ template: 'sign_in_link', toMasked: 'o***@example.com', providerMessageId: 're_abc', status: 'sent', businessId: bizId, userId: ownerId });
    expect(JSON.stringify(rows)).not.toContain('owner@example.com');

    const failing = trackMail(ctx.db, { send: async () => Promise.reject(new Error('Resend rejected the email (429)')) });
    await expect(failing.send({ to: 'b@example.com', subject: 's', text: 't', meta: { template: 'receipt', businessId: bizId } })).rejects.toThrow('429');
    const failed = (await ctx.db.select().from(emailEvents)).find((r) => r.status === 'failed');
    expect(failed).toMatchObject({ template: 'receipt', toMasked: 'b***@example.com', businessId: bizId });
    expect(failed!.details.error).toContain('429');
    expect(sent).toEqual(['owner@example.com', 'x@example.com']);
  });

  it('masks any address', () => {
    expect(maskEmail('muhdfadhil.zainal@gmail.com')).toBe('m***@gmail.com');
    expect(maskEmail('a@b.my')).toBe('a***@b.my');
  });
});
