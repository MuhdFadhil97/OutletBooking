import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { bookings, businesses, businessMembers, customers, payments, refunds, resources, timeOff } from '@outletbooking/db';
import type { Report, Resource, Service } from '@outletbooking/shared';
import { getReport, periodRange, utilisation } from '../src/services/reports';
import { createTestContext, signupInput } from './helpers';

/** O8 reports: periods, totals vs the period before, no-show rate, utilisation, top services, new vs returning, owner only. */
const ctx = createTestContext();
const TZ = 'Asia/Kuala_Lumpur';
/** Wednesday 11 March 2026, noon in Malaysia: the week is Mon 9 … Sun 15 March. */
const NOW = new Date('2026-03-11T12:00:00+08:00');
const at = (date: string, hhmm: string) => new Date(`2026-03-${date}T${hhmm}:00+08:00`);

let ownerA = '';
let ownerB = '';
let staffA = '';
let bizA = 0;
let court1: Resource;
let court2: Resource;
let svcA: Service;
let svcB: Service;

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};

async function addCustomer(name: string, phone: string) {
  const [c] = await ctx.db.insert(customers).values({ businessId: bizA, name, phone }).returning({ id: customers.id });
  return c!.id;
}
async function addBooking(o: { resource: Resource; service: Service; customerId: number; start: Date; end: Date; status: string; priceSen: number }) {
  const [b] = await ctx.db
    .insert(bookings)
    .values({
      businessId: bizA,
      resourceId: o.resource.id,
      serviceId: o.service.id,
      customerId: o.customerId,
      startAt: o.start,
      endAt: o.end,
      blockedStartAt: o.start,
      blockedEndAt: o.end,
      durationMin: (o.end.getTime() - o.start.getTime()) / 60_000,
      status: o.status,
      priceSen: o.priceSen,
    })
    .returning({ id: bookings.id });
  return b!.id;
}

describe('periodRange', () => {
  it('today, Monday–Sunday weeks and calendar months, stepped by offset', () => {
    expect(periodRange('today', 0, '2026-03-11')).toEqual({ from: '2026-03-11', to: '2026-03-11' });
    expect(periodRange('today', -1, '2026-03-01')).toEqual({ from: '2026-02-28', to: '2026-02-28' });
    expect(periodRange('week', 0, '2026-03-15')).toEqual({ from: '2026-03-09', to: '2026-03-15' }); // Sunday
    expect(periodRange('week', -1, '2026-03-11')).toEqual({ from: '2026-03-02', to: '2026-03-08' });
    expect(periodRange('month', 0, '2026-03-11')).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(periodRange('month', -1, '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('month', 10, '2026-03-11')).toEqual({ from: '2027-01-01', to: '2027-01-31' });
  });
});

describe('utilisation', () => {
  const hours = [{ weekday: 1, startTime: '09:00', endTime: '17:00' }]; // Mondays
  it('booked time inside open hours ÷ open hours; time off is not open', () => {
    const r = utilisation(['2026-03-09', '2026-03-10'], TZ, {
      id: 1,
      hours,
      timeOff: [{ start: at('09', '09:00'), end: at('09', '11:00') }],
      booked: [
        { start: at('09', '12:00'), end: at('09', '14:00') },
        { start: at('09', '13:00'), end: at('09', '15:00') }, // overlaps the one above (no-show + rebooked)
        { start: at('09', '16:30'), end: at('09', '18:00') }, // half an hour after closing
      ],
    });
    expect(r).toEqual({ openMin: 360, bookedMin: 210, rate: 210 / 360 });
  });
  it('no open hours → no rate', () => {
    expect(utilisation(['2026-03-10'], TZ, { id: 1, hours, timeOff: [], booked: [] })).toEqual({ openMin: 0, bookedMin: 0, rate: null });
  });
});

describe('reports', () => {
  beforeAll(async () => {
    await ctx.reset();
    expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'rep-a' }))).status).toBe(201);
    expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'rep-b' }))).status).toBe(201);
    ownerA = await ctx.login('a@example.com', 'password123');
    ownerB = await ctx.login('b@example.com', 'password123');
    const [a] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'rep-a'));
    bizA = a!.id;
    const staffUserId = await ctx.createUser('Staff Siti', 'staff@example.com');
    await ctx.db.insert(businessMembers).values({ businessId: bizA, userId: staffUserId, role: 'staff', canViewAll: true });
    staffA = await ctx.login('staff@example.com', 'password123');
    // Start from no resources (the template may have added some).
    await ctx.db.update(resources).set({ deletedAt: new Date() }).where(eq(resources.businessId, bizA));

    court1 = await json<Resource>(await ctx.send('POST', '/resources', ownerA, { name: 'Court 1', resourceType: 'court' }), 201);
    court2 = await json<Resource>(await ctx.send('POST', '/resources', ownerA, { name: 'Court 2', resourceType: 'court' }), 201);
    // Court 1: 09:00–21:00 every day (84 h). Court 2: weekdays 09:00–17:00 (40 h) with Wednesday morning off (−4 h).
    const every = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '09:00', endTime: '21:00' }));
    const weekdays = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' }));
    await json(await ctx.send('PUT', `/resources/${court1.id}/working-hours`, ownerA, { hours: every }));
    await json(await ctx.send('PUT', `/resources/${court2.id}/working-hours`, ownerA, { hours: weekdays }));
    await ctx.db.insert(timeOff).values({ businessId: bizA, resourceId: court2.id, startAt: at('11', '09:00'), endAt: at('11', '13:00') });
    svcA = await json<Service>(await ctx.send('POST', '/services', ownerA, { name: 'Badminton', durationMin: 60, priceSen: 3000, resourceIds: [court1.id, court2.id] }), 201);
    svcB = await json<Service>(await ctx.send('POST', '/services', ownerA, { name: 'Futsal', durationMin: 60, priceSen: 3000, resourceIds: [court1.id, court2.id] }), 201);

    const ali = await addCustomer('Ali', '+60128881020');
    const siti = await addCustomer('Siti', '+60192214410');
    const lee = await addCustomer('Lee', '+60167770912');
    const base = { resource: court1, service: svcA, priceSen: 3000 };
    // Last week: Ali's first booking (so he is "returning" this week) and a cancelled one.
    await addBooking({ ...base, customerId: ali, start: at('05', '10:00'), end: at('05', '11:00'), status: 'completed', priceSen: 4000 });
    await addBooking({ ...base, customerId: lee, start: at('06', '10:00'), end: at('06', '11:00'), status: 'cancelled' });
    // This week.
    const paidOne = await addBooking({ ...base, customerId: ali, start: at('09', '10:00'), end: at('09', '11:00'), status: 'completed' });
    await addBooking({ ...base, customerId: siti, start: at('09', '20:30'), end: at('09', '21:30'), status: 'completed' }); // 30 min open
    await addBooking({ ...base, service: svcB, customerId: siti, start: at('11', '10:00'), end: at('11', '12:00'), status: 'no_show', priceSen: 6000 });
    await addBooking({ ...base, customerId: lee, start: at('11', '10:00'), end: at('11', '11:00'), status: 'confirmed' });
    await addBooking({ ...base, customerId: ali, start: at('13', '18:00'), end: at('13', '19:00'), status: 'cancelled' });
    await addBooking({ ...base, customerId: ali, start: at('14', '09:00'), end: at('14', '10:00'), status: 'pending' });
    await addBooking({ ...base, resource: court2, service: svcB, customerId: ali, start: at('11', '12:00'), end: at('11', '14:00'), status: 'checked_in', priceSen: 5000 });

    await ctx.db.insert(payments).values([
      { businessId: bizA, bookingId: paidOne, purpose: 'full_payment', amountSen: 3000, status: 'paid', paidAt: at('09', '09:00') },
      { businessId: bizA, bookingId: paidOne, purpose: 'balance', amountSen: 999, status: 'paid', paidAt: at('02', '09:00') }, // last week
      { businessId: bizA, bookingId: paidOne, purpose: 'deposit', amountSen: 777, status: 'pending' },
    ]);
    await ctx.db.insert(refunds).values({ businessId: bizA, bookingId: paidOne, amountSen: 1000, method: 'cash', createdAt: at('10', '09:00') });
  });

  afterAll(() => ctx.close());

  it('week: bookings, booked revenue and payments, compared with last week', async () => {
    const r = await getReport(ctx.db, bizA, { period: 'week', offset: 0 }, NOW);
    expect(r).toMatchObject({ period: 'week', from: '2026-03-09', to: '2026-03-15', today: '2026-03-11' });
    expect(r.bookings).toBe(6); // cancelled left out, pending and no-show counted
    expect(r.prevBookings).toBe(1);
    expect(r.revenueSen).toBe(17000); // no-show not counted
    expect(r.prevRevenueSen).toBe(4000);
    expect(r.collectedSen).toBe(3000);
    expect(r.refundedSen).toBe(1000);
    expect(r.noShows).toBe(1);
    expect(r.noShowRate).toBeCloseTo(1 / 6);
    expect(r.statuses).toEqual({ upcoming: 2, checkedIn: 1, completed: 2, noShow: 1, cancelled: 1 });
  });

  it('bookings per day, top services, new vs returning customers', async () => {
    const r = await getReport(ctx.db, bizA, { period: 'week', offset: 0 }, NOW);
    expect(r.perDay.map((d) => d.bookings)).toEqual([2, 0, 3, 0, 0, 1, 0]);
    expect(r.perDay[0]!.date).toBe('2026-03-09');
    expect(r.topServices).toEqual([
      { id: svcA.id, name: 'Badminton', bookings: 4 },
      { id: svcB.id, name: 'Futsal', bookings: 2 },
    ]);
    expect(r.customers).toEqual({ new: 2, returning: 1 });
  });

  it('utilisation per resource and overall', async () => {
    const r = await getReport(ctx.db, bizA, { period: 'week', offset: 0 }, NOW);
    const c1 = r.utilisation.resources.find((x) => x.id === court1.id)!;
    const c2 = r.utilisation.resources.find((x) => x.id === court2.id)!;
    expect(c1).toMatchObject({ name: 'Court 1', openMin: 84 * 60, bookedMin: 60 + 30 + 120 + 60 });
    expect(c2).toMatchObject({ name: 'Court 2', openMin: 36 * 60, bookedMin: 60 });
    expect(r.utilisation.resources).toHaveLength(2); // archived template resources left out
    expect(r.utilisation).toMatchObject({ openMin: 120 * 60, bookedMin: 330, rate: 330 / 7200 });
  });

  it('today, last week and this month', async () => {
    const today = await getReport(ctx.db, bizA, { period: 'today', offset: 0 }, NOW);
    expect(today).toMatchObject({ from: '2026-03-11', to: '2026-03-11', bookings: 3, prevBookings: 0, revenueSen: 8000 });
    const last = await getReport(ctx.db, bizA, { period: 'week', offset: -1 }, NOW);
    expect(last).toMatchObject({ from: '2026-03-02', bookings: 1, revenueSen: 4000, collectedSen: 999, refundedSen: 0 });
    expect(last.customers).toEqual({ new: 1, returning: 0 });
    const month = await getReport(ctx.db, bizA, { period: 'month', offset: 0 }, NOW);
    expect(month.perDay).toHaveLength(31);
    expect(month).toMatchObject({ bookings: 7, revenueSen: 21000 });
  });

  it('owner only, own business only, validated', async () => {
    const mine = await json<Report>(await ctx.get('/reports?period=month&offset=-1', ownerA));
    expect(mine.period).toBe('month');
    const other = await json<Report>(await ctx.get('/reports?period=month', ownerB));
    expect(other.bookings).toBe(0);
    expect(other.utilisation.resources.map((x) => x.name)).not.toContain('Court 1');
    expect((await ctx.get('/reports', staffA)).status).toBe(403);
    expect((await ctx.get('/reports')).status).toBe(401);
    expect((await ctx.get('/reports?period=year', ownerA)).status).toBe(400);
  });
});
