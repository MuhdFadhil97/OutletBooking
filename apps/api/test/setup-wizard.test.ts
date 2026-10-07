import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { businesses, businessMembers, resources, resourceServices, workingHours } from '@outletbooking/db';
import {
  TEMPLATE_INFO,
  applyPaymentRule,
  businessPaymentRule,
  paymentRuleOf,
  type BusinessTemplate,
  type OnboardingSetupInput,
  type Service,
  type SetupSummary,
} from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

const ctx = createTestContext();
let owner = '';
let ownerUserId = 0;
let bizId = 0;

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

async function signup(template: BusinessTemplate, slug = `wiz-${template.replace('_', '-')}`) {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug, template }))).status).toBe(201);
  owner = await ctx.login('a@example.com', 'password123');
  const [b] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, slug));
  bizId = b!.id;
  const [m] = await ctx.db.select({ userId: businessMembers.userId }).from(businessMembers).where(eq(businessMembers.businessId, bizId));
  ownerUserId = m!.userId;
}
const finish = (body: OnboardingSetupInput) => ctx.send('POST', '/businesses/current/onboarding', owner, body);
const svcList = async () => json<Service[]>(await ctx.get('/services', owner));
const hoursFrom = (blocks: { weekdays: number[]; startTime: string; endTime: string }[]) =>
  blocks.flatMap((b) => b.weekdays.map((weekday) => ({ weekday, startTime: b.startTime, endTime: b.endTime })));

afterAll(() => ctx.close());

describe('payment rule helpers', () => {
  const svc = (o: Partial<Parameters<typeof paymentRuleOf>[0]> = {}) => ({
    priceSen: 2000,
    depositSen: 0,
    prepayFull: false,
    priceUnit: 'per_booking' as const,
    ...o,
  });

  it('reads the rule a service follows', () => {
    expect(paymentRuleOf(svc({ prepayFull: true }))).toBe('full');
    expect(paymentRuleOf(svc({ depositSen: 500 }))).toBe('deposit');
    expect(paymentRuleOf(svc())).toBe('at_venue');
    expect(paymentRuleOf(svc({ priceSen: 0 }))).toBe('none');
  });

  it('summarises a business: agreed rule, mixed, free + pay-at-venue = at venue', () => {
    expect(businessPaymentRule([])).toBeNull();
    expect(businessPaymentRule([svc({ prepayFull: true }), svc({ prepayFull: true })])).toBe('full');
    expect(businessPaymentRule([svc({ prepayFull: true }), svc({ depositSen: 100 })])).toBe('mixed');
    expect(businessPaymentRule([svc(), svc({ priceSen: 0 })])).toBe('at_venue');
  });

  it('applies a rule: keeps an existing deposit, caps the default at the price, free + deposit = booking fee', () => {
    expect(applyPaymentRule(svc({ depositSen: 0 }), 'full', 5000)).toEqual({ prepayFull: true, depositSen: 0 });
    expect(applyPaymentRule(svc({ depositSen: 700 }), 'deposit', 5000)).toEqual({ prepayFull: false, depositSen: 700 });
    expect(applyPaymentRule(svc({ priceSen: 2000 }), 'deposit', 5000)).toEqual({ prepayFull: false, depositSen: 2000 });
    expect(applyPaymentRule(svc({ priceUnit: 'per_block' }), 'deposit', 5000)).toEqual({ prepayFull: false, depositSen: 5000 });
    expect(applyPaymentRule(svc({ priceSen: 0 }), 'deposit', 5000)).toEqual({ priceSen: 5000, prepayFull: true, depositSen: 0 });
    expect(applyPaymentRule(svc({ prepayFull: true, depositSen: 300 }), 'at_venue', 5000)).toEqual({ prepayFull: false, depositSen: 0 });
  });

  it('every template is internally consistent', () => {
    for (const [key, info] of Object.entries(TEMPLATE_INFO)) {
      expect(info.paymentRules, key).toContain(info.defaultPaymentRule);
      expect(info.defaultResourceCount, key).toBeGreaterThan(0);
      expect(info.defaultHours.length, key).toBeGreaterThan(0);
      expect(new Set(info.setupExtras).size, key).toBe(2);
    }
  });
});

describe('O1c · POST /businesses/current/onboarding', () => {
  it('sports: creates courts with the same hours, edits prices, applies the payment rule, links everything', async () => {
    await signup('sports');
    const before = await svcList();
    const badminton = before.find((s) => s.name === 'Badminton')!;
    const summary = await json<SetupSummary>(
      await finish({
        resources: [1, 2, 3, 4].map((n) => ({ name: `Court ${n}` })),
        hours: hoursFrom(TEMPLATE_INFO.sports.defaultHours),
        services: [{ id: badminton.id, priceSen: 2200 }],
        paymentRule: 'deposit',
      }),
      201,
    );

    expect(summary).toMatchObject({
      template: 'sports',
      resources: { count: 4, linkedToStaff: 0 },
      hoursVary: false,
      paymentRule: 'deposit',
      services: { count: 3, durationOptions: [60, 120, 180], peakServiceCount: 3 },
    });
    expect(summary.hours).toContainEqual({ weekday: 1, startTime: '08:00', endTime: '24:00' });
    expect(summary.hours).toHaveLength(7);

    const courts = await ctx.db.select({ id: resources.id, type: resources.resourceType }).from(resources).where(eq(resources.businessId, bizId));
    expect(courts.every((c) => c.type === 'court')).toBe(true);
    const wh = await ctx.db.select().from(workingHours).where(eq(workingHours.businessId, bizId));
    expect(wh).toHaveLength(4 * 7);
    const links = await ctx.db.select().from(resourceServices).where(eq(resourceServices.businessId, bizId));
    expect(links).toHaveLength(4 * 3);

    const after = await svcList();
    expect(after.find((s) => s.id === badminton.id)).toMatchObject({ priceSen: 2200, prepayFull: false, depositSen: TEMPLATE_INFO.sports.defaultDepositSen });
  });

  it('runs once: a second Finish (double tap) is refused and creates nothing', async () => {
    await signup('sports');
    const body = { resources: [{ name: 'Court 1' }], hours: [], paymentRule: 'full' as const };
    await json(await finish(body), 201);
    const again = await finish(body);
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe('already_set_up');
    const rows = await ctx.db.select().from(resources).where(and(eq(resources.businessId, bizId), isNull(resources.deletedAt)));
    expect(rows).toHaveLength(1);
  });

  it('real estate: agents with the owner linked, travel time on viewings, free viewings', async () => {
    await signup('real_estate');
    const summary = await json<SetupSummary>(
      await finish({
        resources: [{ name: 'Aina Ismail', isMe: true }, { name: 'Kevin Lim' }],
        hours: hoursFrom(TEMPLATE_INFO.real_estate.defaultHours),
        travelBufferMin: 45,
        paymentRule: 'none',
      }),
      201,
    );
    expect(summary).toMatchObject({ resources: { count: 2, linkedToStaff: 1 }, paymentRule: 'none' });
    const [aina] = await ctx.db.select({ userId: resources.userId, type: resources.resourceType }).from(resources).where(eq(resources.name, 'Aina Ismail'));
    expect(aina).toEqual({ userId: ownerUserId, type: 'staff' });
    const viewing = (await svcList()).find((s) => s.locationType === 'at_customer_location')!;
    expect(viewing.travelBufferMin).toBe(45);
  });

  it('"Booking fee" on free viewings turns them into a small prepaid fee', async () => {
    await signup('real_estate');
    await json(await finish({ resources: [{ name: 'Aina', isMe: true }], hours: [], paymentRule: 'deposit' }), 201);
    for (const s of await svcList()) {
      expect(s).toMatchObject({ priceSen: TEMPLATE_INFO.real_estate.defaultDepositSen, prepayFull: true });
    }
  });

  it('vehicle inspection: hide mobile inspection + store fee/area settings', async () => {
    await signup('vehicle_inspection');
    const mobile = (await svcList()).find((s) => s.locationType === 'at_customer_location')!;
    const summary = await json<SetupSummary>(
      await finish({
        resources: [{ name: 'Bay 1' }, { name: 'Bay 2' }],
        hours: hoursFrom(TEMPLATE_INFO.vehicle_inspection.defaultHours),
        services: [{ id: mobile.id, isVisible: false }],
        paymentRule: 'deposit',
        settings: { mobileFeeSen: 5000, serviceArea: 'Klang Valley' },
      }),
      201,
    );
    expect(summary.mobileServiceVisible).toBe(false);
    expect(summary.settings).toMatchObject({ mobileFeeSen: 5000, serviceArea: 'Klang Valley' });
    expect(summary.bookingFields).toEqual(['Plate number', 'Make & model', 'Year']);
  });

  it('other: chosen label and a first service', async () => {
    await signup('other');
    const summary = await json<SetupSummary>(
      await finish({
        resourceLabel: 'Doctor',
        resources: [{ name: 'Doctor 1' }],
        hours: hoursFrom(TEMPLATE_INFO.other.defaultHours),
        newService: { name: 'Consultation', durationMin: 30, priceSen: 8000 },
        paymentRule: 'at_venue',
      }),
      201,
    );
    expect(summary).toMatchObject({ resourceLabel: 'Doctor', services: { count: 1, minPriceSen: 8000 }, paymentRule: 'at_venue' });
    const links = await ctx.db.select().from(resourceServices).where(eq(resourceServices.businessId, bizId));
    expect(links).toHaveLength(1);
  });

  it('validates: needs a resource, only one "me", plan limit, own services only', async () => {
    await signup('sports');
    expect((await finish({ resources: [], hours: [], paymentRule: 'full' })).status).toBe(400);
    expect((await finish({ resources: [{ name: 'A', isMe: true }, { name: 'B', isMe: true }], hours: [], paymentRule: 'full' })).status).toBe(400);
    const tooMany = await finish({ resources: Array.from({ length: 11 }, (_, i) => ({ name: `Court ${i + 1}` })), hours: [], paymentRule: 'full' });
    expect(tooMany.status).toBe(409);
    expect(await errorCode(tooMany)).toBe('resource_limit');
    const foreign = await finish({ resources: [{ name: 'Court 1' }], hours: [], services: [{ id: 999999, priceSen: 1 }], paymentRule: 'full' });
    expect(foreign.status).toBe(404);
    // Nothing half-done after the failures.
    expect(await ctx.db.select().from(resources).where(eq(resources.businessId, bizId))).toHaveLength(0);
  });

  it('owner only', async () => {
    await signup('sports');
    const staffId = await ctx.createUser('Siti', 'siti@example.com');
    await ctx.db.insert(businessMembers).values({ businessId: bizId, userId: staffId, role: 'staff', canEditSetup: true });
    const siti = await ctx.login('siti@example.com', 'password123');
    const res = await ctx.send('POST', '/businesses/current/onboarding', siti, { resources: [{ name: 'X' }], hours: [], paymentRule: 'full' });
    expect(res.status).toBe(403);
  });
});

describe('ST · summary and payment rule', () => {
  beforeEach(async () => {
    await signup('vehicle_inspection');
    await json(await finish({ resources: [{ name: 'Bay 1' }, { name: 'Bay 2' }], hours: hoursFrom(TEMPLATE_INFO.vehicle_inspection.defaultHours), paymentRule: 'deposit' }), 201);
  });

  it('hours that differ per resource read as "varies"', async () => {
    const [bay] = await ctx.db.select({ id: resources.id }).from(resources).where(eq(resources.name, 'Bay 2'));
    await json(await ctx.send('PUT', `/resources/${bay!.id}/working-hours`, owner, { hours: [{ weekday: 1, startTime: '10:00', endTime: '12:00' }] }));
    const summary = await json<SetupSummary>(await ctx.get('/businesses/current/setup', owner));
    expect(summary).toMatchObject({ hoursVary: true, hours: [] });
  });

  it('PUT /payment-rule moves every service to the rule', async () => {
    const summary = await json<SetupSummary>(await ctx.send('PUT', '/businesses/current/payment-rule', owner, { rule: 'full' }));
    expect(summary.paymentRule).toBe('full');
    expect((await svcList()).every((s) => s.prepayFull && s.depositSen === 0)).toBe(true);
    expect((await ctx.send('PUT', '/businesses/current/payment-rule', owner, { rule: 'card' })).status).toBe(400);
  });

  it('staff need "can change setup"; other businesses see only their own', async () => {
    const staffId = await ctx.createUser('Siti', 'siti@example.com');
    const [m] = await ctx.db
      .insert(businessMembers)
      .values({ businessId: bizId, userId: staffId, role: 'staff' })
      .returning({ id: businessMembers.id });
    const siti = await ctx.login('siti@example.com', 'password123');
    expect((await ctx.get('/businesses/current/setup', siti)).status).toBe(403);
    expect((await ctx.send('PUT', '/businesses/current/payment-rule', siti, { rule: 'full' })).status).toBe(403);
    await ctx.db.update(businessMembers).set({ canEditSetup: true }).where(eq(businessMembers.id, m!.id));
    expect((await json<SetupSummary>(await ctx.get('/businesses/current/setup', siti))).resources.count).toBe(2);

    expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'wiz-other-biz' }))).status).toBe(201);
    const ownerB = await ctx.login('b@example.com', 'password123');
    expect((await json<SetupSummary>(await ctx.get('/businesses/current/setup', ownerB))).resources.count).toBe(0);
  });
});


describe('weekly hours text', () => {
  it('groups consecutive days, Monday first, with breaks and midnight', async () => {
    const { weeklyHoursLine, groupWeeklyHours, expandHours } = await import('@outletbooking/shared');
    expect(weeklyHoursLine(expandHours(TEMPLATE_INFO.sports.defaultHours))).toBe('Mon–Fri 8 AM–12 AM · Sat–Sun 7 AM–12 AM');
    expect(weeklyHoursLine(expandHours(TEMPLATE_INFO.barber_salon.defaultHours))).toBe('Tue–Sun 10 AM–9 PM');
    expect(groupWeeklyHours(expandHours(TEMPLATE_INFO.barber_salon.defaultHours))[0]).toEqual({ days: 'Mon', hours: null });
    expect(
      weeklyHoursLine([
        { weekday: 1, startTime: '09:00', endTime: '12:30' },
        { weekday: 1, startTime: '14:00', endTime: '18:00' },
      ]),
    ).toBe('Mon 9 AM–12:30 PM, 2 PM–6 PM');
    expect(weeklyHoursLine([])).toBe('');
  });
});
