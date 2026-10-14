import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { adminAuditLog, businesses, paymentAccounts, payments, platformAdmins, staffInvitations, subscriptions, users } from '@outletbooking/db';
import {
  adminPlanState,
  type AdminBusinessDetail,
  type AdminBusinessesResponse,
  type AuditEntry,
  type PlanInfo,
  type PublicBusiness,
} from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

/** I1 / I2 platform admin: platform_admins check, audit log with reason in the same transaction (rule 17). */
const ctx = createTestContext();
const DAY = 24 * 3_600_000;
const HOUR = 3_600_000;

let admin = '';
let ownerA = '';
let adminUserId = 0;
let bizA = 0;
let bizB = 0;

const idOf = async (slug: string) =>
  (await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, slug)))[0]!.id;
const setSub = (businessId: number, values: Partial<typeof subscriptions.$inferInsert>) =>
  ctx.db.update(subscriptions).set(values).where(eq(subscriptions.businessId, businessId));
const subOf = async (businessId: number) =>
  (await ctx.db.select().from(subscriptions).where(eq(subscriptions.businessId, businessId)))[0]!;
const auditRows = () => ctx.db.select().from(adminAuditLog);
const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'admin-a', businessName: 'Smash Arena' }))).status).toBe(201);
  expect(
    (await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'admin-b', businessName: 'SemakAuto', template: 'vehicle_inspection' })))
      .status,
  ).toBe(201);
  ownerA = await ctx.login('a@example.com', 'password123');
  bizA = await idOf('admin-a');
  bizB = await idOf('admin-b');
  adminUserId = await ctx.createUser('FTech Admin', 'admin@ftech.my');
  await ctx.db.insert(platformAdmins).values({ userId: adminUserId });
  admin = await ctx.login('admin@ftech.my', 'password123');
  // /admin needs two-step sign-in turned on; the real sign-in flow is tested in admin-sign-in.test.ts.
  await ctx.db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, adminUserId));
});

beforeEach(async () => {
  await ctx.db.delete(adminAuditLog);
  const fresh = {
    plan: 'trial',
    status: 'trialing',
    trialEndsAt: new Date(Date.now() + 5 * DAY),
    currentPeriodStart: null,
    currentPeriodEnd: null,
    freeUntil: null,
    resourceLimit: 10,
  };
  await setSub(bizA, fresh);
  await setSub(bizB, fresh);
  await ctx.db.update(businesses).set({ bookingEnabled: true });
});

afterAll(() => ctx.close());

describe('adminPlanState', () => {
  const now = new Date('2026-10-11T00:00:00Z');
  const later = new Date(now.getTime() + DAY);
  const earlier = new Date(now.getTime() - DAY);
  it('trial, pilot (extended), paying and ended', () => {
    expect(adminPlanState({ status: 'trialing', trialEndsAt: later, currentPeriodEnd: null }, false, now)).toBe('trial');
    expect(adminPlanState({ status: 'trialing', trialEndsAt: later, currentPeriodEnd: null }, true, now)).toBe('pilot');
    expect(adminPlanState({ status: 'trialing', trialEndsAt: earlier, currentPeriodEnd: null }, true, now)).toBe('ended');
    expect(adminPlanState({ status: 'active', trialEndsAt: earlier, currentPeriodEnd: later }, false, now)).toBe('paying');
    expect(adminPlanState(null, false, now)).toBe('ended');
  });
});

describe('access', () => {
  it('needs a login and a platform_admins row — business owners are refused', async () => {
    expect((await ctx.get('/admin/me')).status).toBe(401);
    for (const path of ['/admin/me', '/admin/businesses', `/admin/businesses/${bizB}`, '/admin/audit-log']) {
      expect((await ctx.get(path, ownerA)).status).toBe(403);
    }
    const res = await ctx.send('POST', `/admin/businesses/${bizB}/extend-trial`, ownerA, { days: 30, reason: 'Pilot' });
    expect(res.status).toBe(403);
    expect((await subOf(bizB)).trialEndsAt.getTime()).toBeLessThan(Date.now() + 6 * DAY);
    expect(await auditRows()).toHaveLength(0);
  });

  it('GET /admin/me returns the admin', async () => {
    const res = await ctx.get('/admin/me', admin);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: adminUserId, name: 'FTech Admin', email: 'admin@ftech.my', role: 'support' });
  });
});

describe('I1 businesses list', () => {
  it('lists every business with KPIs, search and filters', async () => {
    await setSub(bizB, { plan: 'business', status: 'active', currentPeriodEnd: new Date(Date.now() + 20 * DAY) });
    const [sub] = await ctx.db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.businessId, bizB));
    await ctx.db
      .insert(payments)
      .values({ businessId: bizB, subscriptionId: sub!.id, purpose: 'subscription', amountSen: 9900, status: 'paid', paidAt: new Date() });

    const all = (await (await ctx.get('/admin/businesses', admin)).json()) as AdminBusinessesResponse;
    expect(all.kpis).toEqual({ businesses: 2, onTrial: 1, trialEndingThisWeek: 1, paying: 1, trialEnded: 0, revenue30dSen: 9900 });
    const a = all.businesses.find((b) => b.id === bizA)!;
    expect(a).toMatchObject({ name: 'Smash Arena', slug: 'admin-a', template: 'sports', ownerName: 'Ali Hassan', state: 'trial', bookings30d: 0 });

    const paying = (await (await ctx.get('/admin/businesses?filter=paying', admin)).json()) as AdminBusinessesResponse;
    expect(paying.businesses.map((b) => b.slug)).toEqual(['admin-b']);
    expect(paying.kpis.businesses).toBe(2);
    const search = (await (await ctx.get('/admin/businesses?q=smash', admin)).json()) as AdminBusinessesResponse;
    expect(search.businesses.map((b) => b.slug)).toEqual(['admin-a']);
    expect((await ctx.get('/admin/businesses?filter=nope', admin)).status).toBe(400);
    await ctx.db.delete(payments);
  });
});

describe('I2 extend trial', () => {
  it('+14 days from the current end, with the reason in the audit log; shows as pilot', async () => {
    const before = (await subOf(bizA)).trialEndsAt;
    const res = await ctx.send('POST', `/admin/businesses/${bizA}/extend-trial`, admin, { days: 14, reason: 'Pilot business' });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as AdminBusinessDetail;
    expect(new Date(detail.subscription!.trialEndsAt).getTime()).toBe(before.getTime() + 14 * DAY);
    expect(detail.state).toBe('pilot');
    expect(detail.auditLog).toHaveLength(1);
    expect(detail.auditLog[0]).toMatchObject({
      action: 'extend_trial',
      reason: 'Pilot business',
      admin: { id: adminUserId, name: 'FTech Admin' },
      business: { id: bizA, name: 'Smash Arena' },
      details: { from: before.toISOString(), days: 14, previousStatus: 'trialing' },
    });
    const list = (await (await ctx.get('/admin/businesses?filter=pilot', admin)).json()) as AdminBusinessesResponse;
    expect(list.businesses.map((b) => b.id)).toEqual([bizA]);
  });

  it('an ended trial restarts from today and the owner can make changes again', async () => {
    await setSub(bizA, { status: 'expired', trialEndsAt: new Date(Date.now() - 3 * DAY) });
    expect(await errCode(await ctx.send('POST', '/resources', ownerA, { name: 'Court 1', resourceType: 'court' }))).toBe('plan_inactive');

    const res = await ctx.send('POST', `/admin/businesses/${bizA}/extend-trial`, admin, { days: 7, reason: 'Support case' });
    expect(res.status).toBe(200);
    const sub = await subOf(bizA);
    expect(sub.status).toBe('trialing');
    expect(Math.abs(sub.trialEndsAt.getTime() - (Date.now() + 7 * DAY))).toBeLessThan(60_000);
    expect((await ctx.send('POST', '/resources', ownerA, { name: 'Court 1', resourceType: 'court' })).status).toBe(201);
  });

  it('"Pick date" runs to the end of that day in Malaysia', async () => {
    const res = await ctx.send('POST', `/admin/businesses/${bizA}/extend-trial`, admin, { until: '2099-01-01', reason: 'Too far' });
    expect(await errCode(res)).toBe('trial_too_long');
    const target = new Date(Date.now() + 40 * DAY).toISOString().slice(0, 10);
    const ok = await ctx.send('POST', `/admin/businesses/${bizA}/extend-trial`, admin, { until: target, reason: 'Pilot' });
    expect(ok.status).toBe(200);
    expect((await subOf(bizA)).trialEndsAt.toISOString()).toBe(new Date(`${target}T15:59:59.999Z`).toISOString());
  });

  it('refuses a missing reason, a date before the trial end, both days and date, and paying businesses', async () => {
    const path = `/admin/businesses/${bizA}/extend-trial`;
    expect((await ctx.send('POST', path, admin, { days: 7 })).status).toBe(400);
    expect((await ctx.send('POST', path, admin, { days: 7, reason: '  ' })).status).toBe(400);
    expect((await ctx.send('POST', path, admin, { days: 7, until: '2026-12-01', reason: 'Pilot' })).status).toBe(400);
    const yesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10);
    expect(await errCode(await ctx.send('POST', path, admin, { until: yesterday, reason: 'Pilot' }))).toBe('trial_date_too_early');

    await setSub(bizA, { plan: 'starter', status: 'active', currentPeriodEnd: new Date(Date.now() + 10 * DAY) });
    const res = await ctx.send('POST', path, admin, { days: 7, reason: 'Pilot' });
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe('on_paid_plan');
    expect((await subOf(bizA)).status).toBe('active');
    expect(await auditRows()).toHaveLength(0);
    expect((await ctx.send('POST', '/admin/businesses/999999/extend-trial', admin, { days: 7, reason: 'Pilot' })).status).toBe(404);
  });
});

describe('I2 booking page switch and notes', () => {
  it('pauses and resumes the public page, each with an audit row', async () => {
    const path = `/admin/businesses/${bizA}/booking-page`;
    expect((await ctx.send('POST', path, admin, { enabled: false })).status).toBe(400);
    const paused = await ctx.send('POST', path, admin, { enabled: false, reason: 'Reported spam' });
    expect(paused.status).toBe(200);
    expect(((await paused.json()) as AdminBusinessDetail).bookingEnabled).toBe(false);
    expect(((await (await ctx.get('/public/admin-a')).json()) as PublicBusiness).bookingEnabled).toBe(false);
    expect(await errCode(await ctx.send('POST', path, admin, { enabled: false, reason: 'Again' }))).toBe('no_change');

    expect((await ctx.send('POST', path, admin, { enabled: true, reason: 'Resolved' })).status).toBe(200);
    expect(((await (await ctx.get('/public/admin-a')).json()) as PublicBusiness).bookingEnabled).toBe(true);
    const log = (await (await ctx.get(`/admin/audit-log?businessId=${bizA}`, admin)).json()) as AuditEntry[];
    expect(log.map((e) => [e.action, e.reason])).toEqual([
      ['resume_booking_page', 'Resolved'],
      ['pause_booking_page', 'Reported spam'],
    ]);
  });

  it('adds a support note', async () => {
    const res = await ctx.send('POST', `/admin/businesses/${bizB}/notes`, admin, { reason: 'Called owner about onboarding' });
    expect(res.status).toBe(201);
    const all = (await (await ctx.get('/admin/audit-log', admin)).json()) as AuditEntry[];
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ action: 'note', business: { id: bizB, name: 'SemakAuto' } });
  });
});

describe('I2 give free months and change plan', () => {
  it('a trial business gets 2 free months on Business from today: paying, free until, shown to the owner', async () => {
    const res = await ctx.send('POST', `/admin/businesses/${bizA}/free-months`, admin, { months: 2, reason: 'Pilot reward' });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as AdminBusinessDetail;
    expect(detail.state).toBe('paying');
    const sub = await subOf(bizA);
    expect(sub).toMatchObject({ plan: 'business', status: 'active', resourceLimit: 10 });
    expect(sub.freeUntil!.toISOString()).toBe(sub.currentPeriodEnd!.toISOString());
    // About two calendar months (59–62 days).
    const days = (sub.currentPeriodEnd!.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(58);
    expect(days).toBeLessThan(63);
    expect(detail.subscription!.freeUntil).toBe(sub.freeUntil!.toISOString());
    expect(detail.auditLog[0]).toMatchObject({
      action: 'give_free_months',
      reason: 'Pilot reward',
      details: { months: 2, plan: 'business', previousPlan: 'trial', previousStatus: 'trialing' },
    });
    // No payment row: free months are not revenue.
    expect(await ctx.db.select().from(payments).where(eq(payments.businessId, bizA))).toHaveLength(0);

    const plan = (await (await ctx.get('/businesses/current/plan', ownerA)).json()) as PlanInfo;
    expect(plan).toMatchObject({ plan: 'business', status: 'active', hasAccess: true, freeUntil: sub.freeUntil!.toISOString() });
  });

  it('a paying business keeps its plan and its period end moves by calendar months (Malaysia)', async () => {
    // 31 Jan 2099 10:00 in Malaysia + 1 month = 28 Feb 2099 10:00.
    await setSub(bizA, { plan: 'starter', status: 'active', currentPeriodEnd: new Date('2099-01-31T02:00:00Z'), resourceLimit: 3 });
    const path = `/admin/businesses/${bizA}/free-months`;
    expect(await errCode(await ctx.send('POST', path, admin, { months: 1, plan: 'business', reason: 'Goodwill' }))).toBe('use_change_plan');
    expect((await ctx.send('POST', path, admin, { months: 1, reason: 'Goodwill' })).status).toBe(200);
    expect(await subOf(bizA)).toMatchObject({
      plan: 'starter',
      resourceLimit: 3,
      currentPeriodEnd: new Date('2099-02-28T02:00:00Z'),
      freeUntil: new Date('2099-02-28T02:00:00Z'),
    });
  });

  it('an ended business can restart on Starter, and the owner can make changes again', async () => {
    await setSub(bizA, { status: 'expired', trialEndsAt: new Date(Date.now() - 3 * DAY) });
    expect(await errCode(await ctx.send('POST', '/resources', ownerA, { name: 'Court X', resourceType: 'court' }))).toBe('plan_inactive');
    const res = await ctx.send('POST', `/admin/businesses/${bizA}/free-months`, admin, { months: 1, plan: 'starter', reason: 'Restart' });
    expect(res.status).toBe(200);
    expect(await subOf(bizA)).toMatchObject({ plan: 'starter', status: 'active', resourceLimit: 3 });
  });

  it('refuses a missing reason, too many months or an unknown plan', async () => {
    const path = `/admin/businesses/${bizA}/free-months`;
    expect((await ctx.send('POST', path, admin, { months: 1 })).status).toBe(400);
    expect((await ctx.send('POST', path, admin, { months: 13, reason: 'Too many' })).status).toBe(400);
    expect((await ctx.send('POST', path, admin, { months: 1, plan: 'gold', reason: 'Bad plan' })).status).toBe(400);
    expect(await auditRows()).toHaveLength(0);
  });

  it('changes a paying business between Starter and Business, keeping the dates', async () => {
    const path = `/admin/businesses/${bizA}/change-plan`;
    expect(await errCode(await ctx.send('POST', path, admin, { plan: 'starter', reason: 'Trial' }))).toBe('not_paying');

    const end = new Date(Date.now() + 20 * DAY);
    await setSub(bizA, { plan: 'business', status: 'active', currentPeriodEnd: end, resourceLimit: 10 });
    expect(await errCode(await ctx.send('POST', path, admin, { plan: 'business', reason: 'Same' }))).toBe('no_change');
    const res = await ctx.send('POST', path, admin, { plan: 'starter', reason: 'Only uses 2 courts' });
    expect(res.status).toBe(200);
    expect(await subOf(bizA)).toMatchObject({ plan: 'starter', status: 'active', resourceLimit: 3, currentPeriodEnd: end });
    const [log] = ((await res.json()) as AdminBusinessDetail).auditLog;
    expect(log).toMatchObject({ action: 'change_plan', details: { from: 'business', to: 'starter' } });
  });
});

describe('I2 owner and staff', () => {
  it('lists the owner, staff and open invitations', async () => {
    const [owner] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, 'a@example.com'));
    await ctx.db.delete(staffInvitations).where(eq(staffInvitations.businessId, bizA));
    await ctx.db.insert(staffInvitations).values([
      { businessId: bizA, email: 'new-staff@example.com', invitedBy: owner!.id },
      { businessId: bizA, email: 'old@example.com', invitedBy: owner!.id, expiresAt: new Date(Date.now() - DAY) },
    ]);
    const detail = (await (await ctx.get(`/admin/businesses/${bizA}`, admin)).json()) as AdminBusinessDetail;
    expect(detail.members[0]).toMatchObject({ role: 'owner', email: 'a@example.com', isActive: true, emailVerified: expect.any(Boolean) });
    expect(detail.invitations.map((i) => [i.email, i.expired]).sort()).toEqual([
      ['new-staff@example.com', false],
      ['old@example.com', true],
    ]);
  });

  it('sends the owner a password reset link, with the reason in the audit log', async () => {
    ctx.outbox.length = 0;
    const path = `/admin/businesses/${bizA}/password-reset`;
    expect((await ctx.send('POST', path, admin, {})).status).toBe(400);
    const res = await ctx.send('POST', path, admin, { reason: 'Owner locked out, called support' });
    expect(res.status).toBe(200);
    expect(ctx.outbox.map((m) => [m.to, m.subject])).toEqual([['a@example.com', 'Reset your OutletBooking password']]);
    const [log] = ((await res.json()) as AdminBusinessDetail).auditLog;
    expect(log).toMatchObject({ action: 'resend_link', details: { link: 'password_reset' } });
  });
});

describe('I2 detail never exposes payment secrets', () => {
  it('shows only whether ToyyibPay is connected', async () => {
    await ctx.db
      .insert(paymentAccounts)
      .values({ businessId: bizA, secretKeyEncrypted: 'ENCRYPTED-SECRET-BLOB', secretKeyLast4: 'wxyz', categoryCode: 'cat-secret', status: 'connected' })
      .onConflictDoUpdate({ target: paymentAccounts.businessId, set: { status: 'connected' } });
    const res = await ctx.get(`/admin/businesses/${bizA}`, admin);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('ENCRYPTED-SECRET-BLOB');
    expect(text).not.toContain('wxyz');
    expect(text).not.toContain('cat-secret');
    const detail = JSON.parse(text) as AdminBusinessDetail;
    expect(detail).toMatchObject({
      toyyibpayConnected: true,
      owner: { name: 'Ali Hassan', email: 'a@example.com' },
      resourceCount: expect.any(Number),
      staffCount: 0,
    });
    expect(detail.subscription!.hasAccess).toBe(true);
    expect(Math.abs(new Date(detail.subscription!.trialEndsAt).getTime() - (Date.now() + 5 * DAY))).toBeLessThan(HOUR);
  });
});
