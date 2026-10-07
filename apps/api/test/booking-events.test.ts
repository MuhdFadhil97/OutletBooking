import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { eq } from 'drizzle-orm';
import { bookingEvents, bookings, businesses, businessMembers, customers } from '@outletbooking/db';
import type { Booking, BookingEvent, Resource, Service } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

const ctx = createTestContext();
let ownerA = '';
let ownerB = '';
let staffA = '';
let bizA = 0;
let staffUserId = 0;
let ownerUserId = 0;
let court1 = 0;
let court2 = 0;
let service = 0;

/** Local date n days from today (inside the 30-day public booking window). */
const day = (n: number) => formatInTimeZone(addDays(new Date(), n), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
const at = (hhmm: string, n = 3) => `${day(n)}T${hhmm}:00+08:00`;

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const create = (startAt: string, resourceId = court1) =>
  ctx.send('POST', '/bookings', ownerA, { serviceId: service, resourceId, startAt, customer: { name: 'Ali', phone: '+60123456789' } });
const setStatus = (cookie: string, id: number, status: string, reason?: string) =>
  ctx.send('POST', `/bookings/${id}/status`, cookie, { status, reason });
const events = async (id: number, cookie = ownerA) => json<BookingEvent[]>(await ctx.get(`/bookings/${id}/events`, cookie));
const types = async (id: number) => (await events(id)).map((e) => e.type);

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'events-a' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'events-b' }))).status).toBe(201);
  ownerA = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');

  const [a] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'events-a'));
  bizA = a!.id;
  const [owner] = await ctx.db.select({ userId: businessMembers.userId }).from(businessMembers).where(eq(businessMembers.businessId, bizA));
  ownerUserId = owner!.userId;
  staffUserId = await ctx.createUser('Staff Siti', 'siti@example.com');
  await ctx.db.insert(businessMembers).values({ businessId: bizA, userId: staffUserId, role: 'staff' });
  staffA = await ctx.login('siti@example.com', 'password123');

  const allWeek = { hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '08:00', endTime: '22:00' })) };
  court1 = (await json<Resource>(await ctx.send('POST', '/resources', ownerA, { name: 'Court 1', resourceType: 'court', userId: staffUserId }), 201)).id;
  court2 = (await json<Resource>(await ctx.send('POST', '/resources', ownerA, { name: 'Court 2', resourceType: 'court' }), 201)).id;
  for (const id of [court1, court2]) await json(await ctx.send('PUT', `/resources/${id}/working-hours`, ownerA, allWeek));
  service = (
    await json<Service>(await ctx.send('POST', '/services', ownerA, { name: 'Court hire', durationMin: 60, priceSen: 2000, resourceIds: [court1, court2] }), 201)
  ).id;
});
afterAll(() => ctx.close());

describe('booking_events', () => {
  it('owner create writes "created" with the owner as actor', async () => {
    const b = await json<Booking>(await create(at('09:00')), 201);
    const [e] = await events(b.id);
    expect(e).toMatchObject({
      type: 'created',
      actor: { id: ownerUserId, name: 'Ali Hassan' },
      details: { source: 'app', status: 'confirmed' },
    });
  });

  it('public create writes "created" with no actor', async () => {
    const res = await ctx.post('/public/events-a/bookings', {
      serviceId: service,
      startAt: at('11:00', 4),
      customer: { name: 'Web Customer', phone: '+60129998888' },
    });
    expect(res.status).toBe(201);
    const [row] = await ctx.db
      .select({ id: bookings.id })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .where(eq(customers.phone, '+60129998888'));
    const [e] = await events(row!.id);
    expect(e).toMatchObject({ type: 'created', actor: null, details: { source: 'web', status: 'confirmed' } });
  });

  it('reschedule records from / to', async () => {
    const b = await json<Booking>(await create(at('13:00')), 201);
    await json<Booking>(await ctx.send('POST', `/bookings/${b.id}/reschedule`, ownerA, { startAt: at('15:00'), resourceId: court2 }));
    const e = (await events(b.id)).at(-1)!;
    expect(e).toMatchObject({
      type: 'rescheduled',
      actor: { id: ownerUserId },
      details: {
        from: { startAt: new Date(at('13:00')).toISOString(), resourceId: court1, durationMin: 60 },
        to: { startAt: new Date(at('15:00')).toISOString(), resourceId: court2, durationMin: 60 },
      },
    });
  });

  it('every status change writes its event, in order, with the actor', async () => {
    const b = await json<Booking>(await create(at('17:00')), 201);
    await json(await setStatus(staffA, b.id, 'checked_in'));
    await json(await setStatus(ownerA, b.id, 'completed'));
    const list = await events(b.id);
    expect(list.map((e) => e.type)).toEqual(['created', 'checked_in', 'completed']);
    expect(list[1]).toMatchObject({ actor: { id: staffUserId, name: 'Staff Siti' }, details: { from: 'confirmed' } });
    expect(list[2]).toMatchObject({ actor: { id: ownerUserId }, details: { from: 'checked_in' } });
  });

  it('cancel and no-show events; cancel keeps the reason', async () => {
    const c = await json<Booking>(await create(at('10:00', 5)), 201);
    await json(await setStatus(ownerA, c.id, 'cancelled', 'Rain'));
    expect((await events(c.id)).at(-1)).toMatchObject({ type: 'cancelled', details: { from: 'confirmed', reason: 'Rain' } });

    const n = await json<Booking>(await create(at('12:00', 5)), 201);
    await json(await setStatus(ownerA, n.id, 'no_show'));
    expect(await types(n.id)).toEqual(['created', 'no_show']);
  });

  it('a pending booking confirmed by the owner writes "confirmed"', async () => {
    const b = await json<Booking>(await create(at('19:00', 5)), 201);
    await ctx.db.update(bookings).set({ status: 'pending' }).where(eq(bookings.id, b.id));
    await json(await setStatus(ownerA, b.id, 'confirmed'));
    expect(await types(b.id)).toEqual(['created', 'confirmed']);
  });

  it('a rejected change writes nothing (same transaction)', async () => {
    const b = await json<Booking>(await create(at('09:00', 6)), 201);
    await json(await setStatus(ownerA, b.id, 'completed'));
    expect((await setStatus(ownerA, b.id, 'cancelled')).status).toBe(409);
    expect((await ctx.send('POST', `/bookings/${b.id}/reschedule`, ownerA, { startAt: at('10:00', 6) })).status).toBe(409);
    expect(await types(b.id)).toEqual(['created', 'completed']);
  });

  it('a clash rolls back: no booking, no event', async () => {
    const before = await ctx.db.select({ id: bookingEvents.id }).from(bookingEvents);
    expect((await create(at('09:00'))).status).toBe(409);
    const after = await ctx.db.select({ id: bookingEvents.id }).from(bookingEvents);
    expect(after.length).toBe(before.length);
  });

  it('timeline is scoped: staff only for their resources, other businesses get 404', async () => {
    const mine = await json<Booking>(await create(at('14:00', 7), court1), 201);
    const other = await json<Booking>(await create(at('14:00', 7), court2), 201);
    expect((await events(mine.id, staffA)).length).toBe(1);
    expect((await ctx.get(`/bookings/${other.id}/events`, staffA)).status).toBe(404);
    expect((await ctx.get(`/bookings/${mine.id}/events`, ownerB)).status).toBe(404);
    expect((await ctx.get(`/bookings/${mine.id}/events`)).status).toBe(401);
  });

  it('the database rejects unknown event types and cross-business rows', async () => {
    const b = await json<Booking>(await create(at('16:00', 7)), 201);
    await expect(
      ctx.db.insert(bookingEvents).values({ businessId: bizA, bookingId: b.id, eventType: 'teleported' as never }),
    ).rejects.toThrow();
    const [bizB] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'events-b'));
    await expect(ctx.db.insert(bookingEvents).values({ businessId: bizB!.id, bookingId: b.id, eventType: 'created' })).rejects.toThrow();
  });
});

describe('PDPA-ready customers', () => {
  it('an anonymised customer (no phone) still shows on its bookings', async () => {
    const b = await json<Booking>(await create(at('18:00', 8)), 201);
    await ctx.db
      .update(customers)
      .set({ name: 'Deleted customer', phone: null, email: null, notes: null, anonymizedAt: new Date() })
      .where(eq(customers.id, b.customer.id));
    const after = await json<Booking>(await ctx.get(`/bookings/${b.id}`, ownerA));
    expect(after.customer).toMatchObject({ name: 'Deleted customer', phone: null });
    // The same phone booking again creates a fresh customer, not the anonymised one.
    const again = await json<Booking>(await create(at('20:00', 8)), 201);
    expect(again.customer.id).not.toBe(b.customer.id);
    expect(again.customer.phone).toBe('+60123456789');
  });

  it('phone stays E.164 when present', async () => {
    await expect(ctx.db.insert(customers).values({ businessId: bizA, name: 'X', phone: '0123456789' })).rejects.toThrow();
  });
});
