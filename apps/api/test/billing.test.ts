import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  billingDetails,
  businesses,
  businessMembers,
  payments,
  platformAdmins,
  plans,
  resources,
  subscriptions,
  users,
  verifications,
} from '@outletbooking/db';
import type { BillingHistory, BillingOverview, BillingPayment, CheckoutResult } from '@outletbooking/shared';
import { settleBackground } from '../src/background';
import { nextPlanPeriod, resetWebSignInCooldowns } from '../src/services/billing';
import { createTestContext, signupInput } from './helpers';

/** Plan payment on the website: sign-in link, checkout on FTech's ToyyibPay account, receipts. */
const KEYS = { PLATFORM_TOYYIBPAY_SECRET_KEY: 'platform-secret', PLATFORM_TOYYIBPAY_CATEGORY_CODE: 'platcat' };
const ctx = createTestContext(KEYS);
const bare = createTestContext(); // platform ToyyibPay not configured
const SITE = 'https://outletbooking.my';
const DAY = 24 * 3_600_000;

let ownerA = '';
let ownerB = '';
let staffA = '';
let bizA = 0;
let bizB = 0;

const idOf = async (slug: string) => (await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, slug)))[0]!.id;
const setSub = (businessId: number, values: Partial<typeof subscriptions.$inferInsert>) =>
  ctx.db.update(subscriptions).set(values).where(eq(subscriptions.businessId, businessId));
const subOf = async (businessId: number) => (await ctx.db.select().from(subscriptions).where(eq(subscriptions.businessId, businessId)))[0]!;
const paymentOf = async (ref: string) => (await ctx.db.select().from(payments).where(eq(payments.billCode, ref)))[0]!;
const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const json = async <T>(res: Response, status = 200): Promise<T> => {
  expect(res.status).toBe(status);
  return (await res.json()) as T;
};

const details = (over: Record<string, unknown> = {}) => ({
  companyName: 'Smash Arena Sdn Bhd',
  ssmNo: '202001012345',
  tin: 'C1234567890',
  address: '12 Jalan Sukan, 47800 Petaling Jaya',
  receiptEmail: 'accounts@smasharena.my',
  ...over,
});
const checkout = (cookie: string, plan = 'starter', over: Record<string, unknown> = {}) =>
  ctx.send('POST', '/billing/checkout', cookie, { plan, details: details(over) });
const startCheckout = async (cookie: string, plan = 'starter') => json<CheckoutResult>(await checkout(cookie, plan), 201);

/** ToyyibPay's server call. */
const callback = (billcode: string, extra: Record<string, string> = {}) =>
  ctx.app.request('/toyyibpay/plan-callback', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ status_id: '1', billcode, order_id: 'OBP_TEST', refno: 'TPREF1', hash: 'not-checked', ...extra }),
  });

const linkIn = (mail: { text: string }) => /(https?:\/\/\S+\/api\/auth\/magic-link\/verify\?\S+)/.exec(mail.text)![1]!;
/** Open an emailed / handed-off link like a browser: a redirect, and the session cookie it sets. */
async function openLink(link: string) {
  const u = new URL(link);
  const res = await ctx.app.request(u.pathname + u.search, { headers: { origin: SITE } });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .filter((c) => !c.endsWith('='))
    .join('; ');
  return { status: res.status, location: res.headers.get('location') ?? '', cookie };
}

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'bill-a', businessName: 'Smash Arena PJ' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'bill-b', businessName: 'SemakAuto', template: 'vehicle_inspection' }))).status).toBe(201);
  // Sign-in links are only made for confirmed emails (see "unconfirmed owners" below).
  await ctx.db.update(users).set({ emailVerified: true }).where(inArray(users.email, ['a@example.com', 'b@example.com']));
  ownerA = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');
  bizA = await idOf('bill-a');
  bizB = await idOf('bill-b');
  // Three courts, so "extra resources above the plan limit" can be tested.
  for (const name of ['Court 1', 'Court 2', 'Court 3']) {
    expect((await ctx.send('POST', '/resources', ownerA, { name, resourceType: 'court' })).status).toBe(201);
  }
  const staffId = await ctx.createUser('Staff Siti', 'siti@example.com');
  await ctx.db.insert(businessMembers).values({ businessId: bizA, userId: staffId, role: 'staff' });
  staffA = await ctx.login('siti@example.com', 'password123');
});

beforeEach(async () => {
  resetWebSignInCooldowns();
  ctx.outbox.length = 0;
  ctx.toyyibpay.bills.clear();
  await ctx.db.delete(payments);
  await ctx.db.delete(billingDetails);
  const trial = { plan: 'trial', status: 'trialing', trialEndsAt: new Date(Date.now() + 5 * DAY), currentPeriodStart: null, currentPeriodEnd: null, resourceLimit: 10 };
  await setSub(bizA, trial);
  await setSub(bizB, trial);
});

afterAll(async () => {
  await ctx.close();
  await bare.close();
});

describe('nextPlanPeriod', () => {
  const now = new Date('2026-10-12T04:00:00Z');
  it('starts when the trial ends, when paid time runs out, or now', () => {
    const trialEnd = new Date('2026-10-17T15:59:59.999Z'); // end of 17 Oct, Malaysia
    expect(nextPlanPeriod({ status: 'trialing', trialEndsAt: trialEnd, currentPeriodEnd: null }, now)).toEqual({
      start: trialEnd,
      end: new Date('2026-11-17T15:59:59.999Z'),
    });
    const paidEnd = new Date('2026-10-20T15:59:59.999Z');
    expect(nextPlanPeriod({ status: 'active', trialEndsAt: trialEnd, currentPeriodEnd: paidEnd }, now).start).toEqual(paidEnd);
    // Ended trial, or paid time already over: starts now.
    expect(nextPlanPeriod({ status: 'trialing', trialEndsAt: new Date('2026-10-01T00:00:00Z'), currentPeriodEnd: null }, now).start).toEqual(now);
    expect(nextPlanPeriod({ status: 'active', trialEndsAt: trialEnd, currentPeriodEnd: new Date('2026-10-01T00:00:00Z') }, now).start).toEqual(now);
    expect(nextPlanPeriod(null, now).start).toEqual(now);
  });

  it('adds a calendar month in Malaysia time (31 Jan + 1 month = 28 Feb)', () => {
    const start = new Date('2027-01-31T04:00:00Z'); // 12:00 on 31 Jan in Malaysia
    expect(nextPlanPeriod({ status: 'active', trialEndsAt: start, currentPeriodEnd: start }, new Date('2027-01-30T00:00:00Z')).end).toEqual(
      new Date('2027-02-28T04:00:00Z'),
    );
  });
});

describe('sign-in link (I13 / I14, email M6)', () => {
  const ask = (email: string) => ctx.post('/billing/sign-in-link', { email });

  it('emails a link to a business owner; it signs them in once, and the link works only once', async () => {
    const res = await ask('A@Example.com');
    expect(await json<{ sent: boolean }>(res)).toEqual({ sent: true });
    expect(ctx.outbox.map((m) => [m.to, m.subject])).toEqual([['a@example.com', 'Your OutletBooking sign-in link']]);
    expect(ctx.outbox[0]!.text).toContain('expires in 15 minutes');
    const link = linkIn(ctx.outbox[0]!);
    expect(link).toContain('callbackURL=');

    const opened = await openLink(link);
    expect(opened.status).toBe(302);
    expect(opened.location).toBe(`${SITE}/billing`);
    expect(opened.cookie).not.toBe('');
    const overview = await json<BillingOverview>(await ctx.get('/billing/overview', opened.cookie));
    expect(overview.signedInAs).toBe('a@example.com');

    const again = await openLink(link);
    expect(again.status).toBe(302);
    expect(again.location).toMatch(new RegExp(`^${SITE}/billing/link-expired\\?error=`));
    expect(again.cookie).toBe('');
  });

  it('an expired link goes to the "link expired" page', async () => {
    await ask('b@example.com');
    const link = linkIn(ctx.outbox[0]!);
    await ctx.db.update(verifications).set({ expiresAt: new Date(Date.now() - 1000) });
    const opened = await openLink(link);
    expect(opened.location).toMatch(new RegExp(`^${SITE}/billing/link-expired\\?error=`));
    expect(opened.cookie).toBe('');
  });

  it('gives the same answer for every email and sends nothing to non-owners, unknown emails and admins', async () => {
    const adminId = await ctx.createUser('FTech Admin', 'admin@ftech.my');
    await ctx.db.insert(platformAdmins).values({ userId: adminId, role: 'super_admin' });
    // An admin who ALSO owns a business must still never get a link (a link would skip the two-step code).
    await ctx.db.insert(businessMembers).values({ businessId: bizB, userId: adminId, role: 'owner' });
    for (const email of ['siti@example.com', 'nobody@example.com', 'admin@ftech.my']) {
      expect(await json<{ sent: boolean }>(await ask(email))).toEqual({ sent: true });
    }
    expect(ctx.outbox).toHaveLength(0);
    // A REMOVED admin who owns a business is an ordinary owner again and gets the link.
    await ctx.db.update(platformAdmins).set({ isActive: false }).where(eq(platformAdmins.userId, adminId));
    await ctx.db.update(users).set({ emailVerified: true }).where(eq(users.id, adminId));
    resetWebSignInCooldowns();
    await ask('admin@ftech.my');
    expect(ctx.outbox.map((m) => [m.to, m.subject])).toEqual([['admin@ftech.my', 'Your OutletBooking sign-in link']]);
    await ctx.db.delete(businessMembers).where(eq(businessMembers.userId, adminId));
    expect((await ask('not an email')).status).toBe(400);
  });

  it('one link a minute per email', async () => {
    await ask('a@example.com');
    await ask('a@example.com');
    expect(ctx.outbox).toHaveLength(1);
    resetWebSignInCooldowns();
    await ask('a@example.com');
    expect(ctx.outbox).toHaveLength(2);
  });

  it('Better Auth’s own public magic-link route is not exposed', async () => {
    const res = await ctx.post('/api/auth/sign-in/magic-link', { email: 'a@example.com' });
    expect(res.status).toBe(404);
    expect(ctx.outbox).toHaveLength(0);
  });
});

describe('the app opens the website already signed in', () => {
  it('a one-time link for the signed-in owner, not emailed; it lands on the pay page with the plan chosen', async () => {
    const { url } = await json<{ url: string }>(await ctx.send('POST', '/billing/web-link', ownerA, { plan: 'business' }));
    expect(ctx.outbox).toHaveLength(0);
    const opened = await openLink(url);
    expect(opened.location).toBe(`${SITE}/billing?plan=business`);
    expect((await ctx.get('/billing/overview', opened.cookie)).status).toBe(200);
    expect((await openLink(url)).location).toContain('/billing/link-expired');
  });

  it('"Billing & receipts" opens the receipts page signed in (the plan is ignored there)', async () => {
    const { url } = await json<{ url: string }>(await ctx.send('POST', '/billing/web-link', ownerA, { page: 'account', plan: 'business' }));
    expect(ctx.outbox).toHaveLength(0);
    const opened = await openLink(url);
    expect(opened.location).toBe(`${SITE}/billing/account`);
    const history = await json<BillingHistory>(await ctx.get('/billing/payments', opened.cookie));
    expect(history.signedInAs).toBe('a@example.com');
  });

  it('with no page it still opens the pay page, and an unknown page is refused', async () => {
    const { url } = await json<{ url: string }>(await ctx.send('POST', '/billing/web-link', ownerA, {}));
    expect((await openLink(url)).location).toBe(`${SITE}/billing`);
    expect((await ctx.send('POST', '/billing/web-link', ownerA, { page: 'admin' })).status).toBe(400);
  });

  it('only the owner; staff and signed-out callers are refused', async () => {
    expect((await ctx.send('POST', '/billing/web-link', staffA, {})).status).toBe(403);
    expect((await ctx.send('POST', '/billing/web-link', staffA, { page: 'account' })).status).toBe(403);
    expect((await ctx.post('/billing/web-link', {})).status).toBe(401);
    expect((await ctx.send('POST', '/billing/web-link', ownerA, { plan: 'gold' })).status).toBe(400);
  });
});

describe('overview', () => {
  it('shows the business, plans, what each would cost, and sensible first receipt details', async () => {
    const o = await json<BillingOverview>(await ctx.get('/billing/overview', ownerA));
    expect(o).toMatchObject({
      signedInAs: 'a@example.com',
      business: { name: 'Smash Arena PJ', slug: 'bill-a' },
      subscription: { plan: 'trial', status: 'trialing', hasAccess: true },
      onlinePaymentAvailable: true,
      detailsSaved: false,
      details: { companyName: 'Smash Arena PJ', receiptEmail: 'a@example.com', ssmNo: null },
    });
    expect(o.plans.map((p) => p.code)).toEqual(['starter', 'business']);
    expect(o.quotes.starter.baseSen).toBe(4900);
    expect(o.quotes.business.baseSen).toBe(9900);
    expect(o.quotes.starter.totalSen).toBe(4900 + o.quotes.starter.extraSen);
    // The next paid month starts when the trial ends.
    const sub = await subOf(bizA);
    expect(o.nextPeriodStart).toBe(sub.trialEndsAt.toISOString());
  });

  it('owner only; each owner sees only their own business', async () => {
    expect((await ctx.get('/billing/overview', staffA)).status).toBe(403);
    expect((await ctx.get('/billing/overview')).status).toBe(401);
    expect((await json<BillingOverview>(await ctx.get('/billing/overview', ownerB))).business.name).toBe('SemakAuto');
  });

  it('says online payment is not available when FTech’s ToyyibPay account is not set up', async () => {
    const o = await json<BillingOverview>(await bare.get('/billing/overview', ownerA));
    expect(o.onlinePaymentAvailable).toBe(false);
    const res = await bare.send('POST', '/billing/checkout', ownerA, { plan: 'starter', details: details() });
    expect(res.status).toBe(503);
    expect(await errCode(res)).toBe('payment_not_configured');
  });
});

describe('checkout', () => {
  it('makes a pending plan payment and a bill on FTech’s own account; saves the receipt details', async () => {
    const out = await startCheckout(ownerA);
    expect(out.paymentUrl).toBe(`https://dev.toyyibpay.test/${out.ref}`);
    const bill = ctx.toyyibpay.bills.get(out.ref)!.input;
    expect(bill).toMatchObject({
      userSecretKey: 'platform-secret',
      categoryCode: 'platcat',
      amountSen: 4900,
      returnUrl: `${SITE}/billing/result`,
      callbackUrl: 'https://api.test/toyyibpay/plan-callback',
      billTo: 'Smash Arena Sdn Bhd',
      billEmail: 'accounts@smasharena.my',
    });
    const p = await paymentOf(out.ref);
    expect(p).toMatchObject({ businessId: bizA, purpose: 'subscription', provider: 'toyyibpay', status: 'pending', amountSen: 4900, receiptNo: null });
    expect(p.subscriptionId).not.toBeNull();
    expect(p.bookingId).toBeNull();
    expect(p.receiptSnapshot).toMatchObject({ companyName: 'Smash Arena Sdn Bhd', ssmNo: '202001012345', plan: 'starter', planName: 'Starter' });
    const [saved] = await ctx.db.select().from(billingDetails).where(eq(billingDetails.businessId, bizA));
    expect(saved).toMatchObject({ companyName: 'Smash Arena Sdn Bhd', tin: 'C1234567890', receiptEmail: 'accounts@smasharena.my' });
    // The next visit starts with what was saved.
    expect((await json<BillingOverview>(await ctx.get('/billing/overview', ownerA))).details.companyName).toBe('Smash Arena Sdn Bhd');
  });

  it('charges the monthly price plus each resource above the plan limit (price set in I12)', async () => {
    await ctx.db.update(plans).set({ resourceLimit: 1, extraResourceSen: 1500 }).where(eq(plans.code, 'starter'));
    try {
      const n = (await ctx.db.select({ n: sql<number>`count(*)::int` }).from(resources).where(eq(resources.businessId, bizA)))[0]!.n;
      expect(n).toBe(3);
      const out = await startCheckout(ownerA);
      expect(ctx.toyyibpay.bills.get(out.ref)!.input.amountSen).toBe(4900 + (n - 1) * 1500);
    } finally {
      await ctx.db.update(plans).set({ resourceLimit: 3, extraResourceSen: 1000 }).where(eq(plans.code, 'starter'));
    }
  });

  it('validates the choice and the receipt details; owner only', async () => {
    expect((await checkout(ownerA, 'gold')).status).toBe(400);
    expect((await checkout(ownerA, 'starter', { receiptEmail: 'nope' })).status).toBe(400);
    expect((await checkout(ownerA, 'starter', { companyName: 'x' })).status).toBe(400);
    expect((await checkout(staffA)).status).toBe(403);
    expect((await ctx.post('/billing/checkout', { plan: 'starter', details: details() })).status).toBe(401);
    expect(await ctx.db.select().from(payments)).toHaveLength(0);
    // A plan hidden from the website can't be bought by a business that is not on it.
    await ctx.db.update(plans).set({ isPublic: false }).where(eq(plans.code, 'business'));
    try {
      expect(await errCode(await checkout(ownerA, 'business'))).toBe('unknown_plan');
    } finally {
      await ctx.db.update(plans).set({ isPublic: true }).where(eq(plans.code, 'business'));
    }
  });

  it('saves receipt details on their own', async () => {
    const res = await ctx.send('PUT', '/billing/receipt-details', ownerA, details({ companyName: 'New Name Sdn Bhd', ssmNo: '' }));
    expect(res.status).toBe(200);
    const [saved] = await ctx.db.select().from(billingDetails).where(eq(billingDetails.businessId, bizA));
    expect(saved).toMatchObject({ companyName: 'New Name Sdn Bhd', ssmNo: null });
  });
});

describe('payment sync: the re-check decides', () => {
  it('callback after a real payment: plan starts when the trial ends, receipt number, receipt email with the PDF', async () => {
    const { ref } = await startCheckout(ownerA);
    const trialEnd = (await subOf(bizA)).trialEndsAt;
    ctx.toyyibpay.pay(ref);
    const res = await callback(ref);
    expect(await res.text()).toBe('OK');
    await settleBackground();

    const p = await paymentOf(ref);
    expect(p).toMatchObject({ status: 'paid', method: 'fpx', amountSen: 4900 });
    expect(p.receiptNo).toMatch(/^OB-\d{4}-\d{6}$/);
    expect(p.transactionRef).toMatch(/^TP/);
    expect(p.paidAt).not.toBeNull();
    const sub = await subOf(bizA);
    expect(sub).toMatchObject({ plan: 'starter', status: 'active' });
    expect(sub.currentPeriodStart!.getTime()).toBe(trialEnd.getTime());
    expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(trialEnd.getTime() + 27 * DAY);
    expect(sub.currentPeriodEnd!.getTime()).toBeLessThan(trialEnd.getTime() + 32 * DAY);
    expect(sub.resourceLimit).toBeGreaterThanOrEqual(3);
    expect(p.receiptSnapshot).toMatchObject({ periodStart: sub.currentPeriodStart!.toISOString(), periodEnd: sub.currentPeriodEnd!.toISOString() });

    expect(ctx.outbox).toHaveLength(1);
    const mail = ctx.outbox[0]!;
    expect(mail).toMatchObject({ to: 'accounts@smasharena.my', subject: `Receipt ${p.receiptNo} — OutletBooking` });
    expect(mail.text).toContain('RM 49.00');
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments![0]!.filename).toBe(`${p.receiptNo}.pdf`);
    expect(mail.attachments![0]!.content.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('is applied once: a repeated callback or return-page visit changes nothing and sends no second receipt', async () => {
    const { ref } = await startCheckout(ownerA);
    ctx.toyyibpay.pay(ref);
    await callback(ref);
    await settleBackground();
    const before = await subOf(bizA);
    const receiptNo = (await paymentOf(ref)).receiptNo;

    await callback(ref);
    await json<BillingPayment>(await ctx.get(`/billing/payments/${ref}`, ownerA));
    await settleBackground();
    expect((await paymentOf(ref)).receiptNo).toBe(receiptNo);
    expect((await subOf(bizA)).currentPeriodEnd!.getTime()).toBe(before.currentPeriodEnd!.getTime());
    expect(ctx.outbox).toHaveLength(1);
  });

  it('the return page alone also confirms a payment (the callback never arrived)', async () => {
    const { ref } = await startCheckout(ownerA);
    const waiting = await json<BillingPayment>(await ctx.get(`/billing/payments/${ref}`, ownerA));
    expect(waiting).toMatchObject({ status: 'pending', receiptNo: null });
    ctx.toyyibpay.pay(ref);
    const done = await json<BillingPayment>(await ctx.get(`/billing/payments/${ref}`, ownerA));
    expect(done).toMatchObject({ status: 'paid', amountSen: 4900, method: 'fpx', plan: 'starter' });
    expect(done.receiptNo).toMatch(/^OB-/);
    expect(done.description).toMatch(/^Starter plan · \d/);
    await settleBackground();
    expect(ctx.outbox).toHaveLength(1);
  });

  it('a forged callback, or one for the wrong amount, does not make a payment paid', async () => {
    const { ref } = await startCheckout(ownerA);
    await callback(ref); // says success, but ToyyibPay has no payment
    expect((await paymentOf(ref)).status).toBe('pending');
    ctx.toyyibpay.pay(ref, 100); // RM 1 instead of RM 49
    await callback(ref);
    expect((await paymentOf(ref)).status).toBe('pending');
    expect((await subOf(bizA)).plan).toBe('trial');
    expect(ctx.outbox).toHaveLength(0);
    expect((await ctx.app.request('/toyyibpay/plan-callback', { method: 'POST', body: new URLSearchParams({}) })).status).toBe(200);
    // Another business's bill code (or one that never existed) is ignored.
    expect((await callback('no-such-bill')).status).toBe(200);
  });

  it('a declined payment shows as failed, and a later successful retry on the same bill still counts', async () => {
    const { ref } = await startCheckout(ownerA);
    ctx.toyyibpay.pay(ref, undefined, '3');
    const failed = await json<BillingPayment>(await ctx.get(`/billing/payments/${ref}`, ownerA));
    expect(failed.status).toBe('failed');
    expect((await subOf(bizA)).plan).toBe('trial');

    ctx.toyyibpay.pay(ref);
    const paid = await json<BillingPayment>(await ctx.get(`/billing/payments/${ref}`, ownerA));
    expect(paid.status).toBe('paid');
    expect((await subOf(bizA)).plan).toBe('starter');
  });

  it('paying again extends from the end of the paid month; an ended plan restarts now', async () => {
    const first = await startCheckout(ownerA, 'business');
    ctx.toyyibpay.pay(first.ref);
    await callback(first.ref);
    const afterFirst = await subOf(bizA);
    expect(afterFirst).toMatchObject({ plan: 'business', status: 'active' });

    const second = await startCheckout(ownerA, 'business');
    ctx.toyyibpay.pay(second.ref);
    await callback(second.ref);
    const afterSecond = await subOf(bizA);
    expect(afterSecond.currentPeriodStart!.getTime()).toBe(afterFirst.currentPeriodEnd!.getTime());
    expect(afterSecond.currentPeriodEnd!.getTime()).toBeGreaterThan(afterFirst.currentPeriodEnd!.getTime() + 27 * DAY);

    // Lapsed long ago: the new month starts now, not in the past.
    await setSub(bizA, { currentPeriodEnd: new Date(Date.now() - 40 * DAY), status: 'expired' });
    const third = await startCheckout(ownerA, 'starter');
    ctx.toyyibpay.pay(third.ref);
    const before = Date.now();
    await callback(third.ref);
    const afterThird = await subOf(bizA);
    expect(afterThird).toMatchObject({ plan: 'starter', status: 'active' });
    expect(afterThird.currentPeriodStart!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('receipt numbers are sequential across businesses', async () => {
    const a = await startCheckout(ownerA);
    const b = await startCheckout(ownerB, 'business');
    ctx.toyyibpay.pay(a.ref);
    ctx.toyyibpay.pay(b.ref);
    await callback(a.ref);
    await callback(b.ref);
    const n = (r: string | null) => Number(r!.split('-')[2]);
    expect(n((await paymentOf(b.ref)).receiptNo)).toBe(n((await paymentOf(a.ref)).receiptNo) + 1);
  });

  it('a resource count above the plan limit keeps working after paying (the limit follows the business)', async () => {
    await ctx.db.update(plans).set({ resourceLimit: 1 }).where(eq(plans.code, 'starter'));
    try {
      const n = (await ctx.db.select({ n: sql<number>`count(*)::int` }).from(resources).where(eq(resources.businessId, bizA)))[0]!.n;
      const { ref } = await startCheckout(ownerA);
      ctx.toyyibpay.pay(ref);
      await callback(ref);
      expect((await subOf(bizA)).resourceLimit).toBe(n); // 3 courts stay bookable on a plan that includes 1
    } finally {
      await ctx.db.update(plans).set({ resourceLimit: 3 }).where(eq(plans.code, 'starter'));
    }
  });
});

describe('receipts and history (I17)', () => {
  it('lists paid payments newest first with the free trial row; the receipt keeps the details it was made with', async () => {
    const one = await startCheckout(ownerA);
    ctx.toyyibpay.pay(one.ref);
    await callback(one.ref);
    const two = await startCheckout(ownerA, 'business');
    ctx.toyyibpay.pay(two.ref);
    await callback(two.ref);
    await startCheckout(ownerA); // left unpaid: not in the history

    // Changing the details afterwards only affects new receipts.
    await ctx.send('PUT', '/billing/receipt-details', ownerA, details({ companyName: 'Renamed Sdn Bhd' }));
    const h = await json<BillingHistory>(await ctx.get('/billing/payments', ownerA));
    expect(h.payments.map((p) => p.ref)).toEqual([two.ref, one.ref]);
    expect(h.payments[0]).toMatchObject({ status: 'paid', plan: 'business', amountSen: 9900 });
    expect(h.trial).not.toBeNull();
    expect(h.details.companyName).toBe('Renamed Sdn Bhd');
    expect((await paymentOf(one.ref)).receiptSnapshot).toMatchObject({ companyName: 'Smash Arena Sdn Bhd' });
    expect(h.subscription).toMatchObject({ plan: 'business', status: 'active' });
  });

  it('downloads the PDF receipt of a paid payment; not of a pending one', async () => {
    const paid = await startCheckout(ownerA);
    const pending = await startCheckout(ownerA);
    ctx.toyyibpay.pay(paid.ref);
    await callback(paid.ref);
    const receiptNo = (await paymentOf(paid.ref)).receiptNo!;

    const res = await ctx.get(`/billing/payments/${paid.ref}/receipt.pdf`, ownerA);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${receiptNo}.pdf"`);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
    expect((await ctx.get(`/billing/payments/${pending.ref}/receipt.pdf`, ownerA)).status).toBe(404);
  });

  it('another business cannot see or download a payment; staff and signed-out visitors cannot either', async () => {
    const { ref } = await startCheckout(ownerA);
    ctx.toyyibpay.pay(ref);
    await callback(ref);
    for (const path of [`/billing/payments/${ref}`, `/billing/payments/${ref}/receipt.pdf`]) {
      expect((await ctx.get(path, ownerB)).status).toBe(404);
      expect((await ctx.get(path, staffA)).status).toBe(403);
      expect((await ctx.get(path)).status).toBe(401);
    }
    expect((await json<BillingHistory>(await ctx.get('/billing/payments', ownerB))).payments).toEqual([]);
    // Nothing of A's payment moved because B asked.
    expect((await paymentOf(ref)).status).toBe('paid');
    expect((await subOf(bizB)).plan).toBe('trial');
  });

  it('a reference in a URL is the ToyyibPay bill code, never the integer id', async () => {
    const { ref } = await startCheckout(ownerA);
    const id = (await paymentOf(ref)).id;
    expect([400, 404]).toContain((await ctx.get(`/billing/payments/${id}`, ownerA)).status);
    expect((await ctx.get('/billing/payments/12345678', ownerA)).status).toBe(404);
    expect((await ctx.get('/billing/payments/bad%20ref', ownerA)).status).toBe(400);
    expect((await ctx.get(`/billing/payments/${ref}`, ownerA)).status).toBe(200);
  });
});

describe('unconfirmed owners (Better Auth deletes the login of an unconfirmed email that uses a link)', () => {
  const FRESH = 'fresh@example.com';
  let fresh = '';

  beforeAll(async () => {
    expect((await ctx.post('/signup', signupInput({ email: FRESH, slug: 'bill-fresh', businessName: 'Fresh Courts' }))).status).toBe(201);
    fresh = await ctx.login(FRESH, 'password123');
  });

  it('asking for a sign-in link sends the confirmation email (M1) instead, and nothing else', async () => {
    expect(await json<{ sent: boolean }>(await ctx.post('/billing/sign-in-link', { email: FRESH }))).toEqual({ sent: true });
    expect(ctx.outbox.map((m) => [m.to, m.subject])).toEqual([[FRESH, 'Confirm your email']]);
    expect(ctx.outbox[0]!.text).not.toContain('magic-link');
  });

  it('the app handoff asks them to confirm first (409) and sends M1; no link is made', async () => {
    const linksBefore = (await ctx.db.select().from(verifications)).length;
    const receipts = await ctx.send('POST', '/billing/web-link', fresh, { page: 'account' });
    expect(receipts.status).toBe(409);
    expect(await errCode(receipts)).toBe('email_not_confirmed');
    ctx.outbox.length = 0;
    const res = await ctx.send('POST', '/billing/web-link', fresh, { plan: 'starter' });
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe('email_not_confirmed');
    expect(ctx.outbox.map((m) => m.subject)).toEqual(['Confirm your email']);
    expect((await ctx.db.select().from(verifications)).length).toBe(linksBefore);
    // Their password login and session are untouched.
    expect((await ctx.get('/me', fresh)).status).toBe(200);
    expect(await ctx.login(FRESH, 'password123')).not.toBe('');
  });

  it('a confirmed owner keeps their password and their other sessions after opening the link', async () => {
    const before = ownerA;
    await ctx.post('/billing/sign-in-link', { email: 'a@example.com' });
    const opened = await openLink(linkIn(ctx.outbox.at(-1)!));
    expect(opened.cookie).not.toBe('');
    expect((await ctx.get('/me', before)).status).toBe(200);
    expect(await ctx.login('a@example.com', 'password123')).not.toBe('');
  });
});

describe('users that are not owners', () => {
  it('a login with no business cannot use billing', async () => {
    const id = await ctx.createUser('Loose User', 'loose@example.com');
    expect(id).toBeGreaterThan(0);
    const cookie = await ctx.login('loose@example.com', 'password123');
    expect((await ctx.get('/billing/overview', cookie)).status).toBe(403);
    await ctx.db.delete(users).where(eq(users.id, id));
  });
});
