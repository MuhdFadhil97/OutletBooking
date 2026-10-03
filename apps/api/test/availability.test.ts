import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  bookings,
  businesses,
  customers,
  resourceServices,
  resources,
  services,
  timeOff,
  workingHours,
} from '@outletbooking/db';
import {
  blockedRange,
  computeSlots,
  getAvailability,
  type ResourceSchedule,
  type SlotInput,
} from '../src/services/availability';
import { AppError } from '../src/errors';
import { createTestContext } from './helpers';

const TZ = 'Asia/Kuala_Lumpur';
const MONDAY = '2026-11-02';
/** Malaysia local time → Date. */
const my = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+08:00`);
const at = (hhmm: string) => my(MONDAY, hhmm);
const iv = (from: string, to: string) => ({ start: at(from), end: at(to) });

const rules = { timezone: TZ, slotIntervalMin: 30, minAdvanceMin: 60, maxDaysAhead: 30 };
const timing = { durationMin: 60, bufferMin: 0, travelBufferMin: 0 };

function resource(id: number, windows: [string, string][], extra: Partial<ResourceSchedule> = {}): ResourceSchedule {
  return { id, hours: windows.map(([startTime, endTime]) => ({ weekday: 1, startTime, endTime })), timeOff: [], busy: [], ...extra };
}

function slots(overrides: Partial<SlotInput>) {
  return computeSlots({
    date: MONDAY,
    now: my('2026-11-01', '00:00'),
    rules,
    timing,
    resources: [resource(1, [['09:00', '12:00']])],
    ...overrides,
  });
}

/** Slot starts as local "HH:MM". */
const starts = (list: { start: Date }[]) =>
  list.map((s) => s.start.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }));

describe('computeSlots', () => {
  it('steps by the slot interval and fits the last slot exactly at closing', () => {
    expect(starts(slots({}))).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
  });

  it('returns UTC instants for Malaysia local times (+08:00)', () => {
    const [first] = slots({});
    expect(first!.start.toISOString()).toBe('2026-11-02T01:00:00.000Z');
    expect(first!.end.toISOString()).toBe('2026-11-02T02:00:00.000Z');
  });

  it('never straddles a break between working windows', () => {
    const list = slots({ resources: [resource(1, [['09:00', '12:00'], ['13:00', '15:00']])] });
    expect(starts(list)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '13:00', '13:30', '14:00']);
  });

  it('only uses the working hours of that weekday', () => {
    const tuesdayOnly: ResourceSchedule = { ...resource(1, []), hours: [{ weekday: 2, startTime: '09:00', endTime: '17:00' }] };
    expect(slots({ resources: [tuesdayOnly] })).toEqual([]);
  });

  it('skips existing bookings but allows back-to-back', () => {
    const list = slots({ resources: [resource(1, [['09:00', '12:00']], { busy: [iv('10:00', '11:00')] })] });
    expect(starts(list)).toEqual(['09:00', '11:00']);
  });

  it('applies the cleanup buffer of the new booking against existing bookings', () => {
    const list = slots({
      timing: { ...timing, bufferMin: 15 },
      resources: [resource(1, [['09:00', '13:00']], { busy: [iv('10:00', '11:15')] })],
    });
    // 09:00 would hold the resource until 10:15; 11:00 starts inside the existing buffer.
    expect(starts(list)).toEqual(['11:30', '12:00']);
  });

  it('applies the travel buffer before and after (real estate viewing)', () => {
    const list = slots({
      timing: { durationMin: 30, bufferMin: 0, travelBufferMin: 30 },
      // Existing viewing shown 13:00–13:30, blocked 12:30–14:00.
      resources: [resource(1, [['12:00', '15:30']], { busy: [iv('12:30', '14:00')] })],
    });
    // A 14:00 viewing is blocked from 13:30 → clash; 14:30 is blocked from 14:00 → OK.
    expect(starts(list)).toEqual(['14:30', '15:00']);
  });

  it('skips time off (holidays, leave)', () => {
    const list = slots({ resources: [resource(1, [['09:00', '12:00']], { timeOff: [iv('10:00', '10:45')] })] });
    expect(starts(list)).toEqual(['09:00', '11:00']);
  });

  it('respects advance notice', () => {
    const list = slots({ now: at('09:20') });
    // Earliest = 10:20 → next slot on the grid is 10:30.
    expect(starts(list)).toEqual(['10:30', '11:00']);
  });

  it('respects max days ahead and never offers past dates', () => {
    const now = my('2026-11-01', '12:00');
    const r = [resource(1, [])];
    r[0]!.hours = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '09:00', endTime: '12:00' }));
    expect(computeSlots({ date: '2026-12-01', now, rules, timing, resources: r })).not.toEqual([]);
    expect(computeSlots({ date: '2026-12-02', now, rules, timing, resources: r })).toEqual([]);
    expect(computeSlots({ date: '2026-10-31', now, rules, timing, resources: r })).toEqual([]);
    // Owner calendar can book outside the window.
    expect(computeSlots({ date: '2026-12-02', now, rules, timing, resources: r, ignoreBookingWindow: true })).not.toEqual([]);
  });

  it('uses the Malaysia date for "today", not the UTC date', () => {
    // 2026-11-01 23:30 UTC is already 2 Nov 07:30 in Malaysia: Monday is today, not tomorrow.
    const list = slots({ now: new Date('2026-11-01T23:30:00Z') });
    expect(starts(list)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
  });

  it('handles windows ending at midnight (24:00)', () => {
    const list = slots({ timing: { ...timing, durationMin: 120 }, rules: { ...rules, slotIntervalMin: 60 }, resources: [resource(1, [['20:00', '24:00']])] });
    expect(starts(list)).toEqual(['20:00', '21:00', '22:00']);
    expect(list.at(-1)!.end.toISOString()).toBe('2026-11-02T16:00:00.000Z'); // 00:00 on 3 Nov local
  });

  it('supports duration options (longer bookings get fewer slots)', () => {
    expect(starts(slots({ timing: { ...timing, durationMin: 120 } }))).toEqual(['09:00', '09:30', '10:00']);
  });

  it('"any available" lists free resources, least busy that day first', () => {
    const list = slots({
      resources: [
        resource(1, [['09:00', '12:00']], { busy: [iv('11:00', '12:00')] }),
        resource(2, [['09:00', '12:00']]),
        resource(3, [['10:00', '12:00']]),
      ],
    });
    expect(list.find((s) => starts([s])[0] === '09:00')!.resourceIds).toEqual([2, 1]);
    // Equal load keeps display order.
    expect(list.find((s) => starts([s])[0] === '10:00')!.resourceIds).toEqual([2, 3, 1]);
    expect(list.find((s) => starts([s])[0] === '11:00')!.resourceIds).toEqual([2, 3]);
  });

  it('blockedRange = travel before, cleanup + travel after', () => {
    expect(blockedRange(at('10:00'), at('11:00'), { bufferMin: 15, travelBufferMin: 30 })).toEqual({
      start: at('09:30'),
      end: at('11:45'),
    });
  });
});

describe('getAvailability (database)', () => {
  const ctx = createTestContext();
  let bizA = 0;
  let bizB = 0;
  let court1 = 0;
  let court2 = 0;
  let court3 = 0;
  let serviceA = 0;
  let serviceB = 0;
  let booked = 0;
  const now = my('2026-11-01', '12:00');

  beforeAll(async () => {
    await ctx.reset();
    const [a, b] = await ctx.db
      .insert(businesses)
      .values([
        { slug: 'avail-a', name: 'Avail A', slotIntervalMin: 60 },
        { slug: 'avail-b', name: 'Avail B' },
      ])
      .returning({ id: businesses.id });
    bizA = a!.id;
    bizB = b!.id;
    const rows = await ctx.db
      .insert(resources)
      .values([
        { businessId: bizA, name: 'Court 1', resourceType: 'court', sortOrder: 1 },
        { businessId: bizA, name: 'Court 2', resourceType: 'court', sortOrder: 2 },
        { businessId: bizA, name: 'Court 3 (not linked)', resourceType: 'court', sortOrder: 3 },
      ])
      .returning({ id: resources.id });
    [court1, court2, court3] = rows.map((r) => r.id) as [number, number, number];
    const [sa, sb] = await ctx.db
      .insert(services)
      .values([
        { businessId: bizA, name: 'Badminton', durationMin: 60, durationOptions: [60, 120], bufferMin: 0 },
        { businessId: bizB, name: 'Other business', durationMin: 60 },
      ])
      .returning({ id: services.id });
    serviceA = sa!.id;
    serviceB = sb!.id;
    await ctx.db.insert(resourceServices).values([
      { businessId: bizA, resourceId: court1, serviceId: serviceA },
      { businessId: bizA, resourceId: court2, serviceId: serviceA },
    ]);
    await ctx.db.insert(workingHours).values(
      [court1, court2, court3].map((resourceId) => ({ businessId: bizA, resourceId, weekday: 1, startTime: '08:00', endTime: '12:00' })),
    );
    const [cust] = await ctx.db
      .insert(customers)
      .values({ businessId: bizA, name: 'Ali', phone: '+60123456789' })
      .returning({ id: customers.id });
    const base = { businessId: bizA, serviceId: serviceA, customerId: cust!.id, durationMin: 60 };
    const [b1] = await ctx.db
      .insert(bookings)
      .values([
        { ...base, resourceId: court1, status: 'confirmed', startAt: at('09:00'), endAt: at('10:00'), blockedStartAt: at('09:00'), blockedEndAt: at('10:00') },
        { ...base, resourceId: court2, status: 'cancelled', startAt: at('09:00'), endAt: at('10:00'), blockedStartAt: at('09:00'), blockedEndAt: at('10:00') },
      ])
      .returning({ id: bookings.id });
    booked = b1!.id;
    await ctx.db.insert(timeOff).values({ businessId: bizA, resourceId: court2, startAt: at('11:00'), endAt: at('12:00') });
  });
  afterAll(() => ctx.close());

  const query = (extra: Record<string, number> = {}) => ({ serviceId: serviceA, date: MONDAY, ...extra });
  const startsIso = (s: { startAt: string; resourceIds: number[] }[]) =>
    s.map((x) => [starts([{ start: new Date(x.startAt) }])[0], x.resourceIds]);

  it('combines working hours, bookings, cancelled bookings, time off and linked resources', async () => {
    const res = await getAvailability(ctx.db, bizA, query(), { now });
    expect(res).toMatchObject({ date: MONDAY, timezone: TZ, durationMin: 60 });
    // Court 3 is not linked to the service; court 1 is busy at 09:00; court 2's cancelled booking frees 09:00;
    // court 2 is off 11:00–12:00. Court 1 has a booking that day, so court 2 comes first.
    expect(startsIso(res.slots)).toEqual([
      ['08:00', [court2, court1]],
      ['09:00', [court2]],
      ['10:00', [court2, court1]],
      ['11:00', [court1]],
    ]);
  });

  it('filters to one resource and supports duration options', async () => {
    const res = await getAvailability(ctx.db, bizA, query({ resourceId: court1, durationMin: 120 }), { now });
    expect(startsIso(res.slots)).toEqual([['10:00', [court1]]]);
  });

  it('a rescheduled booking does not block itself', async () => {
    const res = await getAvailability(ctx.db, bizA, query({ resourceId: court1 }), { now, excludeBookingId: booked });
    expect(startsIso(res.slots).map(([t]) => t)).toEqual(['08:00', '09:00', '10:00', '11:00']);
  });

  it('a business-wide closure removes every slot', async () => {
    const [closure] = await ctx.db
      .insert(timeOff)
      .values({ businessId: bizA, startAt: my(MONDAY, '00:00'), endAt: my('2026-11-03', '00:00'), reason: 'Deepavali' })
      .returning({ id: timeOff.id });
    try {
      expect((await getAvailability(ctx.db, bizA, query(), { now })).slots).toEqual([]);
    } finally {
      await ctx.db.delete(timeOff).where(eq(timeOff.id, closure!.id));
    }
  });

  it('rejects a duration the service does not offer', async () => {
    await expect(getAvailability(ctx.db, bizA, query({ durationMin: 90 }), { now })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_duration',
    });
  });

  it('404s for another business’s service and for resources that do not offer the service', async () => {
    const err = await getAvailability(ctx.db, bizA, { serviceId: serviceB, date: MONDAY }, { now }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 404 });
    await expect(getAvailability(ctx.db, bizB, query(), { now })).rejects.toMatchObject({ status: 404 });
    await expect(getAvailability(ctx.db, bizA, query({ resourceId: court3 }), { now })).rejects.toMatchObject({ status: 404 });
  });
});
