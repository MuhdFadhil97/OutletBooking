import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { eq, sql } from 'drizzle-orm';
import { bookings, businesses, businessMembers, customers, payments } from '@outletbooking/db';
import type { Booking, CustomerList, CustomerProfile, Resource, Service } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

/** D10 / D11 customers: list + filters, profile stats, notes, PDPA erase, owner only, tenant isolation. */
const ctx = createTestContext();
const TZ = 'Asia/Kuala_Lumpur';
const day = (n: number) => formatInTimeZone(addDays(new Date(), n), TZ, 'yyyy-MM-dd');
const at = (hhmm: string, n: number) => `${day(n)}T${hhmm}:00+08:00`;

let ownerA = '';
let ownerB = '';
let staffA = '';
let bizA = 0;
let court: Resource;
let service: Service;
const ALI = { name: 'Ali Hassan', phone: '+60128881020' };
const SITI = { name: 'Siti Aminah', phone: '+60192214410' };

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const errorOf = async (res: Response) => ({ status: res.status, code: ((await res.json()) as { error: { code: string } }).error.code });
const book = async (customer: { name: string; phone: string }, startAt: string, extra: object = {}) =>
  json<Booking>(await ctx.send('POST', '/bookings', ownerA, { serviceId: service.id, resourceId: court.id, startAt, customer, ...extra }), 201);
/** Moves a booking `days` days into the past (the API only books future times) and sets its status. */
async function pastBooking(customer: { name: string; phone: string }, daysAgo: number, status: string, hour = 9) {
  const b = await book(customer, at(`${String(hour).padStart(2, '0')}:00`, 1 + daysAgo));
  await ctx.db
    .update(bookings)
    .set({
      status,
      startAt: sql`${bookings.startAt} - make_interval(days => ${2 * daysAgo + 1})`,
      endAt: sql`${bookings.endAt} - make_interval(days => ${2 * daysAgo + 1})`,
      blockedStartAt: sql`${bookings.blockedStartAt} - make_interval(days => ${2 * daysAgo + 1})`,
      blockedEndAt: sql`${bookings.blockedEndAt} - make_interval(days => ${2 * daysAgo + 1})`,
    })
    .where(eq(bookings.id, b.id));
  return b;
}
const list = async (cookie: string, query = '') => json<CustomerList>(await ctx.get(`/customers${query}`, cookie));

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'cust-a' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'cust-b' }))).status).toBe(201);
  ownerA = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');
  const [a] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'cust-a'));
  bizA = a!.id;
  const staffUserId = await ctx.createUser('Staff Siti', 'staff@example.com');
  await ctx.db.insert(businessMembers).values({ businessId: bizA, userId: staffUserId, role: 'staff', canViewAll: true });
  staffA = await ctx.login('staff@example.com', 'password123');

  court = await json<Resource>(await ctx.send('POST', '/resources', ownerA, { name: 'Court 1', resourceType: 'court' }), 201);
  const allDay = { hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '06:00', endTime: '23:00' })) };
  await json(await ctx.send('PUT', `/resources/${court.id}/working-hours`, ownerA, allDay));
  service = await json<Service>(
    await ctx.send('POST', '/services', ownerA, { name: 'Court hire', durationMin: 60, priceSen: 3000, resourceIds: [court.id] }),
    201,
  );

  // Ali: 5 visits (4 completed + 1 confirmed already over) and 1 no-show → Regular. Siti: 2 no-shows. Lee: new.
  for (let i = 1; i <= 4; i++) await pastBooking(ALI, i * 7, 'completed');
  await pastBooking(ALI, 2, 'confirmed', 10);
  await pastBooking(ALI, 40, 'no_show');
  await pastBooking(SITI, 3, 'no_show', 11);
  await pastBooking(SITI, 5, 'no_show', 12);
  await book({ name: 'Lee Wei', phone: '+60167770912' }, at('18:00', 2));
  // Customer of business B with the same phone as Ali.
  const bCourt = await json<Resource>(await ctx.send('POST', '/resources', ownerB, { name: 'B Court', resourceType: 'court' }), 201);
  const bSvc = await json<Service>(await ctx.send('POST', '/services', ownerB, { name: 'B hire', durationMin: 60, resourceIds: [bCourt.id] }), 201);
  await json(await ctx.send('PUT', `/resources/${bCourt.id}/working-hours`, ownerB, allDay));
  await json(await ctx.send('POST', '/bookings', ownerB, { serviceId: bSvc.id, resourceId: bCourt.id, startAt: at('10:00', 3), customer: ALI }), 201);
});
afterAll(() => ctx.close());

describe('GET /customers (D10)', () => {
  it('lists customers with visits, no-shows and a tag, most recent visit first', async () => {
    const res = await list(ownerA);
    expect(res.total).toBe(3);
    const byName = Object.fromEntries(res.items.map((c) => [c.name, c]));
    expect(byName['Ali Hassan']).toMatchObject({ visits: 5, noShows: 1, tag: 'regular', phone: ALI.phone });
    expect(byName['Siti Aminah']).toMatchObject({ visits: 0, noShows: 2, tag: 'no_shows' });
    expect(byName['Lee Wei']).toMatchObject({ visits: 0, tag: 'new', lastVisitAt: null });
    expect(res.items[0]!.name).toBe('Ali Hassan'); // the only one with visits
  });

  it('filters: Regulars / New / No-shows', async () => {
    expect((await list(ownerA, '?filter=regulars')).items.map((c) => c.name)).toEqual(['Ali Hassan']);
    expect((await list(ownerA, '?filter=new')).items.map((c) => c.name).sort()).toEqual(['Lee Wei', 'Siti Aminah']);
    expect((await list(ownerA, '?filter=no_shows')).items.map((c) => c.name).sort()).toEqual(['Ali Hassan', 'Siti Aminah']);
  });

  it('searches by name or by mobile typed the local way', async () => {
    expect((await list(ownerA, '?q=siti')).items.map((c) => c.name)).toEqual(['Siti Aminah']);
    expect((await list(ownerA, `?q=${encodeURIComponent('012-888 1020')}`)).items.map((c) => c.name)).toEqual(['Ali Hassan']);
    expect((await list(ownerA, '?q=nobody')).total).toBe(0);
  });

  it("only this business's customers; staff cannot open the list", async () => {
    expect((await list(ownerB)).items.map((c) => c.name)).toEqual(['Ali Hassan']);
    expect((await list(ownerB)).items[0]!.visits).toBe(0);
    expect((await ctx.get('/customers', staffA)).status).toBe(403);
  });
});

describe('GET /customers/:id (D11)', () => {
  it('stats, upcoming and history', async () => {
    const id = (await list(ownerA, '?q=Ali')).items[0]!.id;
    const upcoming = await book(ALI, at('20:00', 4));
    const [paidOne] = await ctx.db.select({ id: bookings.id }).from(bookings).where(eq(bookings.customerId, id)).limit(1);
    await ctx.db.insert(payments).values({
      businessId: bizA,
      bookingId: paidOne!.id,
      amountSen: 3000,
      status: 'paid',
      method: 'cash',
      purpose: 'full_payment',
      provider: 'manual',
    });
    const p = await json<CustomerProfile>(await ctx.get(`/customers/${id}`, ownerA));
    expect(p).toMatchObject({ name: 'Ali Hassan', visits: 5, noShows: 1, spentSen: 3000, tag: 'regular' });
    expect(p.upcoming.map((b) => b.id)).toEqual([upcoming.id]);
    expect(p.history).toHaveLength(6);
    expect(p.history[0]!.startAt > p.history[5]!.startAt).toBe(true);
  });

  it('404 for another business', async () => {
    const id = (await list(ownerA, '?q=Ali')).items[0]!.id;
    expect((await ctx.get(`/customers/${id}`, ownerB)).status).toBe(404);
    expect((await ctx.send('PATCH', `/customers/${id}`, ownerB, { notes: 'x' })).status).toBe(404);
    expect((await ctx.send('POST', `/customers/${id}/erase`, ownerB)).status).toBe(404);
  });
});

describe('add and edit', () => {
  it('adds a customer; the same mobile again points at the existing one', async () => {
    const c = await json<CustomerProfile>(await ctx.send('POST', '/customers', ownerA, { name: 'Ahmad Danial', phone: '+60123456700', notes: 'Walk-in regular' }), 201);
    expect(c).toMatchObject({ name: 'Ahmad Danial', notes: 'Walk-in regular', visits: 0, upcoming: [], history: [] });
    const again = await ctx.send('POST', '/customers', ownerA, { name: 'Someone', phone: '+60123456700' });
    expect(await errorOf(again)).toEqual({ status: 409, code: 'customer_exists' });
  });

  it('edits notes, name and email; a mobile used by someone else is refused', async () => {
    const id = (await list(ownerA, '?q=Siti')).items[0]!.id;
    const p = await json<CustomerProfile>(
      await ctx.send('PATCH', `/customers/${id}`, ownerA, { notes: 'Prefers Court 2', name: 'Siti A.', email: 'siti@example.com' }),
    );
    expect(p).toMatchObject({ notes: 'Prefers Court 2', name: 'Siti A.', email: 'siti@example.com' });
    expect(await errorOf(await ctx.send('PATCH', `/customers/${id}`, ownerA, { phone: ALI.phone }))).toEqual({ status: 409, code: 'phone_taken' });
    expect((await ctx.send('PATCH', `/customers/${id}`, ownerA, { notes: '' })).status).toBe(200);
    expect((await ctx.send('PATCH', `/customers/${id}`, staffA, { notes: 'x' })).status).toBe(403);
  });
});

describe('POST /customers/:id/erase (PDPA)', () => {
  it('is refused while the customer has upcoming bookings', async () => {
    const id = (await list(ownerA, '?q=Ali')).items[0]!.id;
    expect(await errorOf(await ctx.send('POST', `/customers/${id}/erase`, ownerA))).toEqual({ status: 409, code: 'has_upcoming_bookings' });
  });

  it('anonymises the customer and their booking details; bookings and payments stay', async () => {
    const id = (await list(ownerA, '?q=Siti')).items[0]!.id;
    const [one] = await ctx.db.select({ id: bookings.id }).from(bookings).where(eq(bookings.customerId, id)).limit(1);
    await ctx.db
      .update(bookings)
      .set({ locationAddress: 'No 1, Jalan Siti', customFields: { plate: 'WXY1234' }, customerNotes: 'Call first' })
      .where(eq(bookings.id, one!.id));

    expect((await ctx.send('POST', `/customers/${id}/erase`, staffA)).status).toBe(403);
    expect((await ctx.send('POST', `/customers/${id}/erase`, ownerA)).status).toBe(204);

    const [c] = await ctx.db.select().from(customers).where(eq(customers.id, id));
    expect(c).toMatchObject({ name: 'Deleted customer', phone: null, email: null, notes: null });
    expect(c!.anonymizedAt).not.toBeNull();
    const rows = await ctx.db.select().from(bookings).where(eq(bookings.customerId, id));
    expect(rows).toHaveLength(2);
    for (const b of rows) expect(b).toMatchObject({ locationAddress: null, customFields: {}, customerNotes: null });

    // Gone from the list and profile; erasing again is a 404.
    expect((await list(ownerA)).items.map((x) => x.id)).not.toContain(id);
    expect((await ctx.get(`/customers/${id}`, ownerA)).status).toBe(404);
    expect((await ctx.send('POST', `/customers/${id}/erase`, ownerA)).status).toBe(404);
    // The booking still shows in the owner's bookings, as "Deleted customer".
    const b = await json<Booking>(await ctx.get(`/bookings/${one!.id}`, ownerA));
    expect(b.customer).toMatchObject({ name: 'Deleted customer', phone: null });
  });

  it('booking again with the same mobile starts a fresh customer', async () => {
    await book(SITI, at('15:00', 6));
    const found = await list(ownerA, '?q=Siti');
    expect(found.items).toHaveLength(1);
    expect(found.items[0]).toMatchObject({ name: 'Siti Aminah', noShows: 0 });
  });
});
