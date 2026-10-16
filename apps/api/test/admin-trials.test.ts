import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { adminAuditLog, businesses, paymentAccounts, payments, platformAdmins, services, subscriptions, users } from '@outletbooking/db';
import type { TrialRow, TrialsResponse } from '@outletbooking/shared';
import { getSetupChecklist, updateSetupChecklist } from '../src/services/checklist';
import { malaysiaDaysUntil } from '../src/services/admin-trials';
import { createTestContext, signupInput } from './helpers';

/** I7 · Trials ending: who to follow up with before their booking page pauses. */
const ctx = createTestContext();
const DAY = 24 * 3_600_000;

let admin = '';
let owner = '';
const ids: Record<string, number> = {};

const setSub = (businessId: number, values: Partial<typeof subscriptions.$inferInsert>) =>
  ctx.db.update(subscriptions).set(values).where(eq(subscriptions.businessId, businessId));
const trial = (days: number) => ({
  plan: 'trial',
  status: 'trialing',
  trialEndsAt: new Date(Date.now() + days * DAY),
  currentPeriodStart: null,
  currentPeriodEnd: null,
  freeUntil: null,
});
const get = async (qs = '') => {
  const res = await ctx.get(`/admin/trials${qs}`, admin);
  expect(res.status).toBe(200);
  return (await res.json()) as TrialsResponse;
};
const names = (r: TrialsResponse) => r.trials.map((t) => t.name);

beforeAll(async () => {
  await ctx.reset();
  const make = [
    ['soon', 'Smash Arena', 'sports', '+60121110001'],
    ['week', 'Futsal Hub', 'sports', '+60121110002'],
    ['ended', 'Kedai Gunting', 'barber_salon', '+60121110003'],
    ['old', 'Old Ended', 'sports', '+60121110004'],
    ['paying', 'Paying Co', 'sports', '+60121110005'],
    ['later', 'Laman Realty', 'real_estate', '+60121110006'],
  ] as const;
  for (const [key, businessName, template, phone] of make) {
    const res = await ctx.post('/signup', signupInput({ email: `${key}@example.com`, slug: `trial-${key}`, businessName, template, phone }));
    expect(res.status).toBe(201);
    ids[key] = (await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, `trial-${key}`)))[0]!.id;
  }
  owner = await ctx.login('soon@example.com', 'password123');
  const adminId = await ctx.createUser('FTech Admin', 'admin@ftech.my');
  await ctx.db.insert(platformAdmins).values({ userId: adminId });
  admin = await ctx.login('admin@ftech.my', 'password123');
  // /admin needs two-step sign-in turned on; the real sign-in flow is tested in admin-sign-in.test.ts.
  await ctx.db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, adminId));
});

beforeEach(async () => {
  await ctx.db.delete(payments);
  await ctx.db.delete(adminAuditLog);
  await setSub(ids.soon!, trial(1));
  await setSub(ids.week!, trial(5));
  await setSub(ids.ended!, { ...trial(-3), status: 'expired' });
  await setSub(ids.old!, { ...trial(-40), status: 'expired' });
  await setSub(ids.paying!, { ...trial(-10), plan: 'starter', status: 'active', currentPeriodEnd: new Date(Date.now() + 20 * DAY) });
  await setSub(ids.later!, trial(20));
});

afterAll(() => ctx.close());

describe('malaysiaDaysUntil', () => {
  it('counts Malaysia calendar days', () => {
    const now = new Date('2026-10-14T15:30:00Z'); // 11:30 pm Wed 14 Oct in Malaysia
    expect(malaysiaDaysUntil(new Date('2026-10-14T16:30:00Z'), now)).toBe(1); // 12:30 am Thu
    expect(malaysiaDaysUntil(new Date('2026-10-14T15:59:59Z'), now)).toBe(0);
    expect(malaysiaDaysUntil(new Date('2026-10-11T15:59:59Z'), now)).toBe(-3);
  });
});

describe('GET /admin/trials', () => {
  it('admins only', async () => {
    expect((await ctx.get('/admin/trials')).status).toBe(401);
    expect((await ctx.get('/admin/trials', owner)).status).toBe(403);
  });

  it('"This week" by default, soonest first; paying and long-ended businesses are left out', async () => {
    const r = await get();
    expect(names(r)).toEqual(['Smash Arena', 'Futsal Hub']);
    expect(r.trials[0]).toMatchObject({ daysLeft: 1, ended: false, extended: false, bookingsInTrial: 0, setupTotal: 5 });
    expect(names(await get('?filter=soon'))).toEqual(['Smash Arena']);
    expect(names(await get('?filter=ended'))).toEqual(['Kedai Gunting']);
    expect((await get('?filter=ended')).trials[0]).toMatchObject({ ended: true, daysLeft: -3 });
    expect((await ctx.get('/admin/trials?filter=paying', admin)).status).toBe(400);
  });

  it('KPIs: ends today or tomorrow, this week, ended not paid, trial → paid in 90 days', async () => {
    expect((await get()).kpis).toEqual({
      endsSoon: 1,
      endThisWeek: 2,
      endedNotPaid: 1,
      // Ended in the last 90 days: Kedai Gunting, Old Ended, Paying Co — none paid yet.
      conversion: { ended: 3, paid: 0 },
    });
    const [sub] = await ctx.db.select().from(subscriptions).where(eq(subscriptions.businessId, ids.paying!));
    await ctx.db
      .insert(payments)
      .values({ businessId: ids.paying!, subscriptionId: sub!.id, purpose: 'subscription', amountSen: 4900, status: 'paid', paidAt: new Date() });
    expect((await get()).kpis.conversion).toEqual({ ended: 3, paid: 1 });
  });

  it('search by name, link or phone (0… finds +60…)', async () => {
    expect(names(await get('?filter=week&q=futsal'))).toEqual(['Futsal Hub']);
    expect(names(await get('?filter=week&q=trial-soon'))).toEqual(['Smash Arena']);
    expect(names(await get('?filter=week&q=0121110002'))).toEqual(['Futsal Hub']);
    expect(names(await get('?filter=week&q=12'))).toEqual([]);
  });

  it('setup progress matches the owner’s D8 checklist; "Never set up" = only the account step', async () => {
    await updateSetupChecklist(ctx.db, ids.later!, { linkShared: true });
    const never = await get('?filter=never');
    const all = [...(await get('?filter=week')).trials, ...(await get('?filter=ended')).trials, ...never.trials];
    const later = await get('?filter=never&q=laman');
    const rows = new Map<number, TrialRow>(all.map((t) => [t.id, t]));
    for (const id of [ids.soon!, ids.week!, ids.ended!]) {
      expect(rows.get(id)?.setupDone).toBe((await getSetupChecklist(ctx.db, id)).doneCount);
    }
    expect(never.trials.every((t) => t.setupDone <= 1)).toBe(true);
    // Laman Realty shared its link, so it is not "never set up" any more.
    expect(later.trials).toEqual([]);
    expect((await getSetupChecklist(ctx.db, ids.later!)).doneCount).toBeGreaterThan(1);
  });

  it('ToyyibPay: connected, not yet (a service takes a deposit), or not needed — never the key', async () => {
    await ctx.db.update(services).set({ depositSen: 0, prepayFull: false }).where(eq(services.businessId, ids.week!));
    await ctx.db.update(services).set({ depositSen: 1000 }).where(eq(services.businessId, ids.soon!));
    let r = await get();
    expect(r.trials.find((t) => t.id === ids.week)?.payments).toBe('not_needed');
    expect(r.trials.find((t) => t.id === ids.soon)?.payments).toBe('not_yet');
    await ctx.db
      .insert(paymentAccounts)
      .values({ businessId: ids.soon!, secretKeyEncrypted: 'ENCRYPTED-SECRET-BLOB', secretKeyLast4: 'wxyz', categoryCode: 'cat-x', status: 'connected' });
    const res = await ctx.get('/admin/trials', admin);
    const text = await res.text();
    expect(text).not.toContain('ENCRYPTED-SECRET-BLOB');
    expect(text).not.toContain('wxyz');
    r = JSON.parse(text) as TrialsResponse;
    expect(r.trials.find((t) => t.id === ids.soon)?.payments).toBe('connected');
  });

  it('shows extended trials, last active time and the WhatsApp number', async () => {
    const adminRow = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, 'admin@ftech.my'));
    await ctx.db.insert(adminAuditLog).values({ adminUserId: adminRow[0]!.id, businessId: ids.soon!, action: 'extend_trial', reason: 'Pilot' });
    await ctx.db.update(businesses).set({ whatsappPhone: '+60199998888' }).where(eq(businesses.id, ids.soon!));
    const soon = (await get()).trials.find((t) => t.id === ids.soon)!;
    expect(soon.extended).toBe(true);
    expect(soon.phone).toBe('+60199998888');
    // The owner logged in during setup, so there is a session.
    expect(soon.lastActiveAt).not.toBeNull();
    expect(Date.now() - Date.parse(soon.lastActiveAt!)).toBeLessThan(60 * 60_000);
    expect((await get()).trials.find((t) => t.id === ids.week)?.phone).toBe('+60121110002');
  });
});
