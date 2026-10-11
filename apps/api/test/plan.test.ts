import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { eq } from 'drizzle-orm';
import { businesses, businessMembers, subscriptions } from '@outletbooking/db';
import {
  hasPlanAccess,
  planMonthlySen,
  recommendedPlan,
  type MeResponse,
  type PlanInfo,
  type PublicBusiness,
  type Resource,
  type Service,
} from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

/** E3 / E4 / F3: plan access, view-only app and paused booking page after the trial (FR-16.3). */
const ctx = createTestContext();
const TZ = 'Asia/Kuala_Lumpur';
const day = (n: number) => formatInTimeZone(addDays(new Date(), n), TZ, 'yyyy-MM-dd');
const HOUR = 3_600_000;

describe('hasPlanAccess', () => {
  const now = new Date('2026-03-11T04:00:00Z');
  const before = new Date(now.getTime() - HOUR);
  const after = new Date(now.getTime() + HOUR);
  it('trial until it ends; paid until the period ends; expired never', () => {
    expect(hasPlanAccess({ status: 'trialing', trialEndsAt: after, currentPeriodEnd: null }, now)).toBe(true);
    expect(hasPlanAccess({ status: 'trialing', trialEndsAt: before, currentPeriodEnd: null }, now)).toBe(false);
    expect(hasPlanAccess({ status: 'active', trialEndsAt: before, currentPeriodEnd: after }, now)).toBe(true);
    expect(hasPlanAccess({ status: 'active', trialEndsAt: before, currentPeriodEnd: before }, now)).toBe(false);
    expect(hasPlanAccess({ status: 'active', trialEndsAt: before, currentPeriodEnd: null }, now)).toBe(true);
    expect(hasPlanAccess({ status: 'past_due', trialEndsAt: before, currentPeriodEnd: after }, now)).toBe(true);
    expect(hasPlanAccess({ status: 'cancelled', trialEndsAt: before, currentPeriodEnd: after }, now)).toBe(true);
    expect(hasPlanAccess({ status: 'cancelled', trialEndsAt: before, currentPeriodEnd: null }, now)).toBe(false);
    expect(hasPlanAccess({ status: 'expired', trialEndsAt: after, currentPeriodEnd: after }, now)).toBe(false);
    expect(hasPlanAccess(null, now)).toBe(false);
  });
  it('recommends Business above 3 resources or with staff; extra resources cost RM 10', () => {
    expect(recommendedPlan(3, 0)).toBe('starter');
    expect(recommendedPlan(4, 0)).toBe('business');
    expect(recommendedPlan(1, 1)).toBe('business');
    expect(planMonthlySen('starter', 5)).toBe(4900 + 2 * 1000);
    expect(planMonthlySen('business', 4)).toBe(9900);
  });
});

describe('after the trial', () => {
  let owner = '';
  let staff = '';
  let ownerB = '';
  let biz = 0;
  let court: Resource;
  let service: Service;
  const setSub = (values: Partial<typeof subscriptions.$inferInsert>) =>
    ctx.db.update(subscriptions).set(values).where(eq(subscriptions.businessId, biz));
  const endTrial = () => setSub({ status: 'trialing', trialEndsAt: new Date(Date.now() - HOUR), currentPeriodEnd: null });
  const code = async (res: Response) => ({ status: res.status, code: ((await res.json()) as { error: { code: string } }).error.code });

  beforeAll(async () => {
    await ctx.reset();
    expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'plan-a' }))).status).toBe(201);
    expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'plan-b' }))).status).toBe(201);
    owner = await ctx.login('a@example.com', 'password123');
    ownerB = await ctx.login('b@example.com', 'password123');
    const [a] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'plan-a'));
    biz = a!.id;
    const staffUserId = await ctx.createUser('Staff Siti', 'staff@example.com');
    await ctx.db.insert(businessMembers).values({ businessId: biz, userId: staffUserId, role: 'staff', canViewAll: true, canEditSetup: true });
    staff = await ctx.login('staff@example.com', 'password123');

    court = (await (await ctx.send('POST', '/resources', owner, { name: 'Court 1', resourceType: 'court' })).json()) as Resource;
    const allDay = { hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '06:00', endTime: '23:00' })) };
    await ctx.send('PUT', `/resources/${court.id}/working-hours`, owner, allDay);
    service = (await (await ctx.send('POST', '/services', owner, { name: 'Court hire', durationMin: 60, resourceIds: [court.id] })).json()) as Service;
  });

  afterAll(() => ctx.close());

  it('E3: current plan, what the business uses, website payment links by slug', async () => {
    const res = await ctx.get('/businesses/current/plan', owner);
    expect(res.status).toBe(200);
    const info = (await res.json()) as PlanInfo;
    expect(info).toMatchObject({ plan: 'trial', status: 'trialing', hasAccess: true, staffCount: 1, recommended: 'business' });
    expect(info.resourceCount).toBeGreaterThanOrEqual(1);
    expect(info.payUrls.starter).toBe('https://outletbooking.my/billing?business=plan-a&plan=starter');
    expect(info.payUrls.business).toContain('plan=business');
    expect((await ctx.get('/businesses/current/plan', staff)).status).toBe(403);
  });

  it('E4: trial ended → /me says no access; reading works, changes are refused for owner and staff', async () => {
    await endTrial();
    const me = (await (await ctx.get('/me', owner)).json()) as MeResponse;
    expect(me.subscription).toMatchObject({ isTrialActive: false, hasAccess: false, trialDaysLeft: 0 });

    expect((await ctx.get('/services', owner)).status).toBe(200);
    expect((await ctx.get(`/bookings?from=${day(0)}&to=${day(7)}`, owner)).status).toBe(200);
    expect((await ctx.get('/reports', owner)).status).toBe(200);
    expect((await ctx.get('/businesses/current/plan', owner)).status).toBe(200);

    expect(await code(await ctx.send('POST', '/services', owner, { name: 'X', durationMin: 60, resourceIds: [court.id] }))).toEqual({
      status: 403,
      code: 'plan_inactive',
    });
    expect(await code(await ctx.send('PATCH', '/businesses/current', owner, { name: 'New name' }))).toMatchObject({ code: 'plan_inactive' });
    expect(
      await code(
        await ctx.send('POST', '/bookings', owner, {
          serviceId: service.id,
          resourceId: court.id,
          startAt: `${day(2)}T10:00:00+08:00`,
          customer: { name: 'Ali', phone: '+60128881020' },
        }),
      ),
    ).toMatchObject({ code: 'plan_inactive' });
    expect(await code(await ctx.send('POST', '/time-off', staff, { startAt: `${day(3)}T00:00:00+08:00`, endAt: `${day(4)}T00:00:00+08:00` }))).toMatchObject({
      code: 'plan_inactive',
    });
    // Account things stay open.
    expect((await ctx.send('PUT', '/me/push-token', owner, { token: 'ExponentPushToken[x]', platform: 'android' })).status).toBe(204);
    // Other businesses are not affected.
    expect((await ctx.send('POST', '/resources', ownerB, { name: 'B court', resourceType: 'court' })).status).toBe(201);
  });

  it('F3: the booking page is paused; slots and new bookings are refused', async () => {
    await endTrial();
    const page = (await (await ctx.get('/public/plan-a')).json()) as PublicBusiness;
    expect(page.bookingEnabled).toBe(false);
    expect(page.name).toBeTruthy(); // still shown, with contact buttons
    expect((await ctx.get(`/public/plan-a/slots?serviceId=${service.id}&date=${day(2)}`)).status).toBe(403);
    const res = await ctx.post('/public/plan-a/bookings', {
      serviceId: service.id,
      resourceId: court.id,
      startAt: `${day(2)}T10:00:00+08:00`,
      customer: { name: 'Ali', phone: '+60128881020' },
    });
    expect(await code(res)).toEqual({ status: 403, code: 'booking_disabled' });
    expect(((await (await ctx.get('/public/plan-b')).json()) as PublicBusiness).bookingEnabled).toBe(true);
  });

  it('a paid plan opens everything again; an ended period closes it', async () => {
    await setSub({ plan: 'business', status: 'active', currentPeriodEnd: addDays(new Date(), 30) });
    expect(((await (await ctx.get('/me', owner)).json()) as MeResponse).subscription.hasAccess).toBe(true);
    expect((await ctx.send('PATCH', '/businesses/current', owner, { name: 'Paid Courts' })).status).toBe(200);
    expect(((await (await ctx.get('/public/plan-a')).json()) as PublicBusiness).bookingEnabled).toBe(true);

    await setSub({ currentPeriodEnd: new Date(Date.now() - HOUR) });
    expect((await ctx.send('PATCH', '/businesses/current', owner, { name: 'Late' })).status).toBe(403);
    expect(((await (await ctx.get('/public/plan-a')).json()) as PublicBusiness).bookingEnabled).toBe(false);
  });
});
