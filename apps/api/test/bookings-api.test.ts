import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { businesses, businessMembers, customers, resources } from '@outletbooking/db';
import type { Availability, Booking, Resource, Service } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

const ctx = createTestContext();
let ownerA = '';
let ownerB = '';
let staffA = '';
let court1 = 0;
let court2 = 0;
let serviceA = 0;
let serviceB = 0;
let resourceB = 0;

/** Monday 2 Nov 2026, Malaysia time. */
const at = (hhmm: string, date = '2026-11-02') => `${date}T${hhmm}:00+08:00`;

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const errorOf = async (res: Response) => ({
  status: res.status,
  code: ((await res.json()) as { error: { code: string } }).error.code,
});

const customer = { name: 'Ali', phone: '+60123456789' };
const create = (cookie: string, body: Record<string, unknown>) =>
  ctx.send('POST', '/bookings', cookie, { serviceId: serviceA, customer, ...body });
const list = async (cookie: string, qs = 'from=2026-11-02&to=2026-11-03') =>
  json<Booking[]>(await ctx.get(`/bookings?${qs}`, cookie));

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'cal-a' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'cal-b' }))).status).toBe(201);
  ownerA = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');

  const [a] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'cal-a'));
  const staffUserId = await ctx.createUser('Staff Siti', 'siti@example.com');
  await ctx.db.insert(businessMembers).values({ businessId: a!.id, userId: staffUserId, role: 'staff' });
  staffA = await ctx.login('siti@example.com', 'password123');

  const allWeek = { hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '08:00', endTime: '22:00' })) };
  court1 = (await json<Resource>(await ctx.send('POST', '/resources', ownerA, { name: 'Court 1', resourceType: 'court', userId: staffUserId, sortOrder: 1 }), 201)).id;
  court2 = (await json<Resource>(await ctx.send('POST', '/resources', ownerA, { name: 'Court 2', resourceType: 'court', sortOrder: 2 }), 201)).id;
  for (const id of [court1, court2]) {
    await json(await ctx.send('PUT', `/resources/${id}/working-hours`, ownerA, allWeek));
  }
  serviceA = (
    await json<Service>(
      await ctx.send('POST', '/services', ownerA, {
        name: 'Court hire',
        durationMin: 60,
        durationOptions: [60, 120],
        priceUnit: 'per_block',
        priceSen: 2000,
        prepayFull: true,
        priceRules: [{ name: 'Peak', weekday: 1, startTime: '18:00', endTime: '22:00', priceSen: 3000 }],
        resourceIds: [court1, court2],
      }),
      201,
    )
  ).id;

  resourceB = (await json<Resource>(await ctx.send('POST', '/resources', ownerB, { name: 'B Court', resourceType: 'court' }), 201)).id;
  serviceB = (await json<Service>(await ctx.send('POST', '/services', ownerB, { name: 'B hire', durationMin: 60, resourceIds: [resourceB] }), 201)).id;
});
afterAll(() => ctx.close());

describe('create', () => {
  let first: Booking;

  it('creates a confirmed, priced booking and the customer', async () => {
    first = await json<Booking>(await create(ownerA, { resourceId: court1, startAt: at('10:00'), durationMin: 120, customFields: { players: 4 } }), 201);
    expect(first).toMatchObject({
      status: 'confirmed',
      source: 'app',
      durationMin: 120,
      startAt: '2026-11-02T02:00:00.000Z',
      endAt: '2026-11-02T04:00:00.000Z',
      resource: { id: court1, name: 'Court 1' },
      service: { id: serviceA, name: 'Court hire' },
      customer: { name: 'Ali', phone: '+60123456789' },
      priceSen: 4000,
      amountDueSen: 4000,
      paymentStatus: 'unpaid',
      customFields: { players: 4 },
    });
    expect(first).not.toHaveProperty('publicToken');
  });

  it('rejects a clash on the same resource with a friendly 409', async () => {
    const res = await create(ownerA, { resourceId: court1, startAt: at('11:00') });
    expect(await errorOf(res)).toEqual({ status: 409, code: 'slot_taken' });
  });

  it('"any available" picks a free resource, then reports the slot as taken', async () => {
    const b = await json<Booking>(await create(ownerA, { startAt: at('10:00') }), 201);
    expect(b.resource.id).toBe(court2);
    expect(await errorOf(await create(ownerA, { startAt: at('10:30') }))).toEqual({ status: 409, code: 'slot_taken' });
  });

  it('"any available" prefers the least busy resource', async () => {
    // Court 1 has 2h booked, court 2 has 1h → court 2.
    const b = await json<Booking>(await create(ownerA, { startAt: at('15:00') }), 201);
    expect(b.resource.id).toBe(court2);
  });

  it('checks working hours unless the owner overrides', async () => {
    expect(await errorOf(await create(ownerA, { resourceId: court1, startAt: at('07:00') }))).toEqual({ status: 409, code: 'outside_hours' });
    const b = await json<Booking>(await create(ownerA, { resourceId: court1, startAt: at('07:00'), allowOutsideHours: true, source: 'walk_in' }), 201);
    expect(b.source).toBe('walk_in');
  });

  it('allows any start minute, not only the slot grid', async () => {
    await json<Booking>(await create(ownerA, { resourceId: court1, startAt: at('12:15') }), 201);
  });

  it('applies peak pricing', async () => {
    const b = await json<Booking>(await create(ownerA, { resourceId: court1, startAt: at('17:00'), durationMin: 120 }), 201);
    expect(b.priceSen).toBe(2000 + 3000);
  });

  it('reuses the customer by phone and updates the name', async () => {
    const b = await json<Booking>(await create(ownerA, { resourceId: court1, startAt: at('20:00'), customer: { name: 'Ali Hassan', phone: '+60123456789' } }), 201);
    expect(b.customer).toMatchObject({ id: first.customer.id, name: 'Ali Hassan' });
    const rows = await ctx.db.select().from(customers).where(eq(customers.phone, '+60123456789'));
    expect(rows).toHaveLength(1);
  });

  it('validates input', async () => {
    expect((await create(ownerA, { resourceId: court1, startAt: at('09:00'), durationMin: 90 })).status).toBe(400);
    expect(await errorOf(await create(ownerA, { resourceId: court1, startAt: at('09:00'), customFields: { colour: 'red' } }))).toEqual({ status: 400, code: 'invalid_custom_fields' });
    expect(await errorOf(await create(ownerA, { resourceId: court1, startAt: at('09:00'), customFields: { players: 'four' } }))).toEqual({ status: 400, code: 'invalid_custom_fields' });
    expect((await create(ownerA, { resourceId: court1, startAt: at('09:00'), customer: { name: 'X', phone: '0123' } })).status).toBe(400);
  });

  it('only one of two simultaneous requests for the same slot wins', async () => {
    const [r1, r2] = await Promise.all([
      create(ownerA, { resourceId: court2, startAt: at('19:00') }),
      create(ownerA, { resourceId: court2, startAt: at('19:30') }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
  });
});

describe('list, detail, availability', () => {
  it('lists bookings for Malaysia dates in time order', async () => {
    const rows = await list(ownerA);
    expect(rows.length).toBeGreaterThanOrEqual(8);
    const starts = rows.map((r) => r.startAt);
    expect([...starts].sort()).toEqual(starts);
    // 07:00 Monday in Malaysia is Sunday 23:00 UTC — still on Monday's calendar.
    expect(rows.some((r) => r.startAt === '2026-11-01T23:00:00.000Z')).toBe(true);
    expect(await list(ownerA, 'from=2026-11-03&to=2026-11-04')).toEqual([]);
  });

  it('filters by resource', async () => {
    const rows = await list(ownerA, `from=2026-11-02&to=2026-11-03&resourceId=${court2}`);
    expect(rows.every((r) => r.resource.id === court2)).toBe(true);
  });

  it('rejects ranges over 42 days', async () => {
    expect((await ctx.get('/bookings?from=2026-11-01&to=2027-01-01', ownerA)).status).toBe(400);
  });

  it('returns slots for the calendar (no advance-notice limit)', async () => {
    const res = await json<Availability>(await ctx.get(`/bookings/availability?serviceId=${serviceA}&date=2026-11-02&resourceId=${court1}`, ownerA));
    const times = res.slots.map((s) => s.startAt);
    expect(times).toContain('2026-11-02T00:00:00.000Z'); // 08:00
    expect(times).not.toContain('2026-11-02T02:00:00.000Z'); // 10:00 is booked
  });
});

describe('reschedule and edit', () => {
  let b: Booking;
  beforeAll(async () => {
    b = await json<Booking>(await create(ownerA, { resourceId: court1, startAt: at('09:00', '2026-11-03') }), 201);
  });

  it('moves to a new time, overlapping its own old slot', async () => {
    const moved = await json<Booking>(await ctx.send('POST', `/bookings/${b.id}/reschedule`, ownerA, { startAt: at('09:30', '2026-11-03') }));
    expect(moved.startAt).toBe('2026-11-03T01:30:00.000Z');
  });

  it('moves to another resource and re-prices', async () => {
    const moved = await json<Booking>(
      await ctx.send('POST', `/bookings/${b.id}/reschedule`, ownerA, { startAt: at('18:00'), resourceId: court2, durationMin: 60 }),
    );
    expect(moved).toMatchObject({ resource: { id: court2 }, priceSen: 3000 });
  });

  it('refuses a taken time', async () => {
    const res = await ctx.send('POST', `/bookings/${b.id}/reschedule`, ownerA, { startAt: at('10:00'), resourceId: court2 });
    expect(await errorOf(res)).toEqual({ status: 409, code: 'slot_taken' });
  });

  it('edits notes', async () => {
    const res = await ctx.send('PATCH', `/bookings/${b.id}`, ownerA, { internalNotes: 'Regular', customerNotes: '' });
    expect(await json<Booking>(res)).toMatchObject({ internalNotes: 'Regular', customerNotes: null });
  });
});

describe('status flow', () => {
  let b: Booking;
  beforeAll(async () => {
    b = await json<Booking>(await create(ownerA, { resourceId: court1, startAt: at('09:00', '2026-11-04') }), 201);
  });
  const setStatus = (cookie: string, id: number, status: string, reason?: string) =>
    ctx.send('POST', `/bookings/${id}/status`, cookie, { status, reason });

  it('confirmed → checked in → completed, then final', async () => {
    expect((await json<Booking>(await setStatus(ownerA, b.id, 'checked_in'))).status).toBe('checked_in');
    expect(await errorOf(await setStatus(ownerA, b.id, 'no_show'))).toEqual({ status: 409, code: 'invalid_status_change' });
    expect((await json<Booking>(await setStatus(ownerA, b.id, 'completed'))).status).toBe('completed');
    expect(await errorOf(await setStatus(ownerA, b.id, 'cancelled'))).toEqual({ status: 409, code: 'invalid_status_change' });
    expect(await errorOf(await ctx.send('POST', `/bookings/${b.id}/reschedule`, ownerA, { startAt: at('11:00', '2026-11-04') }))).toEqual({
      status: 409,
      code: 'not_reschedulable',
    });
  });

  it('cancelling stores the reason, hides it from the calendar and frees the slot', async () => {
    const c = await json<Booking>(await create(ownerA, { resourceId: court1, startAt: at('14:00', '2026-11-04') }), 201);
    const cancelled = await json<Booking>(await setStatus(ownerA, c.id, 'cancelled', 'Customer called'));
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'Customer called' });
    const day = 'from=2026-11-04&to=2026-11-05';
    expect((await list(ownerA, day)).some((r) => r.id === c.id)).toBe(false);
    expect((await list(ownerA, `${day}&includeInactive=true`)).some((r) => r.id === c.id)).toBe(true);
    await json<Booking>(await create(ownerA, { resourceId: court1, startAt: at('14:00', '2026-11-04') }), 201);
  });
});

describe('staff access', () => {
  it('sees only bookings on their linked resource', async () => {
    const rows = await list(staffA);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.resource.id === court1)).toBe(true);
    const other = (await list(ownerA)).find((r) => r.resource.id === court2)!;
    expect((await ctx.get(`/bookings/${other.id}`, staffA)).status).toBe(404);
    expect((await ctx.send('POST', `/bookings/${other.id}/status`, staffA, { status: 'checked_in' })).status).toBe(404);
  });

  it('can check in, but not create, cancel, edit or reschedule', async () => {
    const mine = (await list(staffA)).find((r) => r.status === 'confirmed')!;
    expect((await json<Booking>(await ctx.send('POST', `/bookings/${mine.id}/status`, staffA, { status: 'checked_in' }))).status).toBe('checked_in');
    expect((await ctx.send('POST', `/bookings/${mine.id}/status`, staffA, { status: 'cancelled' })).status).toBe(403);
    expect((await create(staffA, { resourceId: court1, startAt: at('09:00', '2026-11-05') })).status).toBe(403);
    expect((await ctx.send('PATCH', `/bookings/${mine.id}`, staffA, { internalNotes: 'x' })).status).toBe(403);
    expect((await ctx.send('POST', `/bookings/${mine.id}/reschedule`, staffA, { startAt: at('09:00', '2026-11-05') })).status).toBe(403);
    expect((await ctx.get(`/bookings/availability?serviceId=${serviceA}&date=2026-11-02`, staffA)).status).toBe(403);
  });

  it('staff with "view all" see every resource', async () => {
    const [biz] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'cal-a'));
    await ctx.db.update(businessMembers).set({ canViewAll: true }).where(eq(businessMembers.businessId, biz!.id));
    try {
      expect((await list(staffA)).some((r) => r.resource.id === court2)).toBe(true);
    } finally {
      await ctx.db.update(businessMembers).set({ canViewAll: false }).where(eq(businessMembers.role, 'staff'));
    }
  });
});

describe('tenant isolation', () => {
  it('owner B cannot see or change business A’s bookings', async () => {
    const a = (await list(ownerA))[0]!;
    expect(await list(ownerB)).toEqual([]);
    expect((await ctx.get(`/bookings/${a.id}`, ownerB)).status).toBe(404);
    expect((await ctx.send('PATCH', `/bookings/${a.id}`, ownerB, { internalNotes: 'hijack' })).status).toBe(404);
    expect((await ctx.send('POST', `/bookings/${a.id}/status`, ownerB, { status: 'cancelled' })).status).toBe(404);
    expect((await ctx.send('POST', `/bookings/${a.id}/reschedule`, ownerB, { startAt: at('09:00', '2026-11-06') })).status).toBe(404);
  });

  it('cannot book with another business’s service or resource', async () => {
    expect((await create(ownerA, { serviceId: serviceB, startAt: at('09:00', '2026-11-06') })).status).toBe(404);
    expect((await create(ownerA, { resourceId: resourceB, startAt: at('09:00', '2026-11-06') })).status).toBe(404);
    expect((await ctx.get(`/bookings/availability?serviceId=${serviceB}&date=2026-11-02`, ownerA)).status).toBe(404);
  });

  it('ignores a business_id sent by the client', async () => {
    const [bizB] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'cal-b'));
    const b = await json<Booking>(await create(ownerA, { resourceId: court1, startAt: at('09:00', '2026-11-06'), businessId: bizB!.id }), 201);
    const [r] = await ctx.db.select({ businessId: resources.businessId }).from(resources).where(eq(resources.id, b.resource.id));
    expect(r!.businessId).not.toBe(bizB!.id);
  });
});
