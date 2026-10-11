import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { adminAuditLog, businesses, paymentAccounts, payments, platformAdmins, subscriptions } from '@outletbooking/db';
import {
  adminPlanState,
  type AdminBusinessDetail,
  type AdminBusinessesResponse,
  type AuditEntry,
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
});

beforeEach(async () => {
  await ctx.db.delete(adminAuditLog);
  const fresh = { plan: 'trial', status: 'trialing', trialEndsAt: new Date(Date.now() + 5 * DAY), currentPeriodEnd: null };
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
    expect(await res.json()).toEqual({ userId: adminUserId, name: 'FTech Admin', email: 'admin@ftech.my' });
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
