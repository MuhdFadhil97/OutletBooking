import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { eq } from 'drizzle-orm';
import { bookings, businesses, businessMembers, customers, plans, subscriptions } from '@outletbooking/db';
import type { Booking, MeResponse, Resource, Service, StaffInvitation } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

/** Plan features are enforced: Starter has no staff app, Reports or Customer history; trial and Business have all. */
const ctx = createTestContext();
const TZ = 'Asia/Kuala_Lumpur';
const tomorrow = () => `${formatInTimeZone(addDays(new Date(), 1), TZ, 'yyyy-MM-dd')}T10:00:00+08:00`;

let owner = '';
let staff = '';
let ownerB = '';
let biz = 0;
let court: Resource;
let service: Service;

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const code = async (res: Response) => ({ status: res.status, code: ((await res.json()) as { error: { code: string } }).error.code });
const setSub = (values: Partial<typeof subscriptions.$inferInsert>) =>
  ctx.db.update(subscriptions).set(values).where(eq(subscriptions.businessId, biz));
const starter = () => setSub({ plan: 'starter', status: 'active', currentPeriodEnd: addDays(new Date(), 20) });
const business = () => setSub({ plan: 'business', status: 'active', currentPeriodEnd: addDays(new Date(), 20) });
const trial = () => setSub({ plan: 'trial', status: 'trialing', trialEndsAt: addDays(new Date(), 5), currentPeriodEnd: null });

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'feat-a' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'feat-b' }))).status).toBe(201);
  owner = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');
  biz = (await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'feat-a')))[0]!.id;

  court = await json<Resource>(await ctx.send('POST', '/resources', owner, { name: 'Court 1', resourceType: 'court' }), 201);
  const allDay = { hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '06:00', endTime: '23:00' })) };
  await json(await ctx.send('PUT', `/resources/${court.id}/working-hours`, owner, allDay));
  service = await json<Service>(
    await ctx.send('POST', '/services', owner, { name: 'Court hire', durationMin: 60, priceSen: 3000, resourceIds: [court.id] }),
    201,
  );
  const staffUserId = await ctx.createUser('Staff Siti', 'staff@example.com');
  await ctx.db.insert(businessMembers).values({ businessId: biz, userId: staffUserId, role: 'staff', canViewAll: true });
  staff = await ctx.login('staff@example.com', 'password123');
});
afterAll(() => ctx.close());

describe('free trial and Business keep everything', () => {
  for (const [name, set] of [['trial', trial], ['business', business]] as const) {
    it(`${name}: staff list, reports, customers, and the staff login all work`, async () => {
      await set();
      expect((await ctx.get('/staff', owner)).status).toBe(200);
      expect((await ctx.get('/reports', owner)).status).toBe(200);
      expect((await ctx.get('/customers', owner)).status).toBe(200);
      expect((await ctx.get('/me/schedule?from=2026-10-21&to=2026-10-22', staff)).status).toBe(200);
      const me = await json<MeResponse>(await ctx.get('/me', staff));
      expect(me.staffLocked).toBe(false);
      expect(me.subscription.features).toEqual({ online_payment: true, staff_app: true, reports: true });
    });
  }
});

describe('Starter', () => {
  it('refuses the staff list, invites, reports and customer history with plan_feature', async () => {
    await starter();
    expect(await code(await ctx.get('/staff', owner))).toEqual({ status: 403, code: 'plan_feature' });
    expect(await code(await ctx.send('POST', '/staff/invitations', owner, { email: 'x@example.com', resourceId: null }))).toEqual({
      status: 403,
      code: 'plan_feature',
    });
    expect(await code(await ctx.get('/reports', owner))).toEqual({ status: 403, code: 'plan_feature' });
    expect(await code(await ctx.get('/customers', owner))).toEqual({ status: 403, code: 'plan_feature' });
    expect(await code(await ctx.get('/customers/1', owner))).toEqual({ status: 403, code: 'plan_feature' });
  });

  it('tells the app what the plan includes', async () => {
    await starter();
    const me = await json<MeResponse>(await ctx.get('/me', owner));
    expect(me.subscription.plan).toBe('starter');
    expect(me.subscription.features).toEqual({ online_payment: true, staff_app: false, reports: false });
    expect(me.staffLocked).toBe(false);
  });

  it('still takes bookings and keeps the customer name, and PDPA erase still works', async () => {
    await starter();
    const b = await json<Booking>(
      await ctx.send('POST', '/bookings', owner, {
        serviceId: service.id,
        resourceId: court.id,
        startAt: tomorrow(),
        customer: { name: 'Ali Hassan', phone: '+60128881020' },
      }),
      201,
    );
    expect(b.customer?.name).toBe('Ali Hassan');
    const [cust] = await ctx.db.select().from(customers).where(eq(customers.businessId, biz));
    expect(cust?.name).toBe('Ali Hassan');
    // A customer with an upcoming booking cannot be erased; once it is cancelled the erase goes through.
    await ctx.db.update(bookings).set({ status: 'cancelled' }).where(eq(bookings.id, b.id));
    expect((await ctx.send('POST', `/customers/${cust!.id}/erase`, owner)).status).toBe(204);
  });

  it('hides existing staff: /me explains, everything else is refused, rows stay', async () => {
    await starter();
    const me = await json<MeResponse>(await ctx.get('/me', staff));
    expect(me.staffLocked).toBe(true);
    expect(await code(await ctx.get('/me/schedule?from=2026-10-21&to=2026-10-22', staff))).toEqual({ status: 403, code: 'staff_app_locked' });
    expect(await code(await ctx.get('/bookings', staff))).toEqual({ status: 403, code: 'staff_app_locked' });
    expect(await ctx.db.select().from(businessMembers).where(eq(businessMembers.businessId, biz))).toHaveLength(2);
  });

  it('refuses an old invitation: joining needs the staff app', async () => {
    await trial();
    const inv = await json<StaffInvitation>(
      await ctx.send('POST', '/staff/invitations', owner, { email: 'new@example.com', resourceId: null }),
      201,
    );
    await starter();
    const token = inv.inviteUrl.split('/invite/')[1]!;
    const res = await ctx.send('POST', `/invitations/${token}/accept`, '', {
      name: 'New Staff',
      phone: '+60111222333',
      password: 'password123',
      acceptTerms: true,
    });
    expect(await code(res)).toEqual({ status: 403, code: 'plan_feature' });
  });

  it('another business is not affected', async () => {
    await starter();
    expect((await ctx.get('/staff', ownerB)).status).toBe(200);
    expect((await ctx.get('/customers', ownerB)).status).toBe(200);
  });

  it('upgrading to Business gives it all back, hidden staff included', async () => {
    await starter();
    expect((await ctx.get('/reports', owner)).status).toBe(403);
    await business();
    expect((await ctx.get('/reports', owner)).status).toBe(200);
    expect((await ctx.get('/staff', owner)).status).toBe(200);
    expect((await json<MeResponse>(await ctx.get('/me', staff))).staffLocked).toBe(false);
    expect((await ctx.get('/customers', owner)).status).toBe(200);
  });

  it('follows the flags FTech sets on I12 (the plan row overrides the defaults)', async () => {
    await starter();
    const [row] = await ctx.db.select({ features: plans.features }).from(plans).where(eq(plans.code, 'starter'));
    const original = row!.features;
    // Only the flags change (and are put back): other test files share this table.
    await ctx.db.update(plans).set({ features: { online_payment: true, staff_app: true, reports: false } }).where(eq(plans.code, 'starter'));
    try {
      expect((await ctx.get('/staff', owner)).status).toBe(200);
      expect((await ctx.get('/reports', owner)).status).toBe(403);
      expect((await json<MeResponse>(await ctx.get('/me', staff))).staffLocked).toBe(false);
    } finally {
      await ctx.db.update(plans).set({ features: original }).where(eq(plans.code, 'starter'));
    }
  });
});
