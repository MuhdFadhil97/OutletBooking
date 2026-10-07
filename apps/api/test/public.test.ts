import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { eq } from 'drizzle-orm';
import { bookingFields, businesses, customers } from '@outletbooking/db';
import type { Availability, Booking, PublicBookingConfirmation, PublicBusiness, Resource, Service } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

const ctx = createTestContext();
let ownerA = '';
let ownerB = '';

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'arena-a', businessName: 'Arena A' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'arena-b', businessName: 'Arena B' }))).status).toBe(201);
  ownerA = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');
});
afterAll(() => ctx.close());

describe('GET /public/:slug', () => {
  it('returns the business and its visible services without logging in', async () => {
    const shown = await json<Service>(
      await ctx.send('POST', '/services', ownerA, { name: 'Court hire', durationMin: 60, priceSen: 4000 }),
      201,
    );
    const hidden = await json<Service>(
      await ctx.send('POST', '/services', ownerA, { name: 'Members only', durationMin: 60, isVisible: false }),
      201,
    );
    const deleted = await json<Service>(await ctx.send('POST', '/services', ownerA, { name: 'Old', durationMin: 30 }), 201);
    expect((await ctx.send('DELETE', `/services/${deleted.id}`, ownerA)).status).toBe(204);

    const biz = await json<PublicBusiness>(await ctx.get('/public/arena-a'));
    expect(biz).toMatchObject({ slug: 'arena-a', name: 'Arena A', timezone: 'Asia/Kuala_Lumpur', bookingEnabled: true });
    const ids = biz.services.map((s) => s.id);
    expect(ids).toContain(shown.id);
    expect(ids).not.toContain(hidden.id);
    expect(ids).not.toContain(deleted.id);
    expect(biz.services.find((s) => s.id === shown.id)).toEqual({
      id: shown.id,
      name: 'Court hire',
      description: null,
      durationMin: 60,
      durationOptions: null,
      priceUnit: 'per_booking',
      priceSen: 4000,
      depositSen: 0,
      prepayFull: false,
      locationType: 'at_business',
    });
  });

  it('only shows that business, and no internal fields', async () => {
    const bServices = await json<Service[]>(await ctx.get('/services', ownerB));
    const a = await json<PublicBusiness>(await ctx.get('/public/arena-a'));
    expect(a.services.map((s) => s.id)).not.toEqual(expect.arrayContaining(bServices.map((s) => s.id)));
    expect(Object.keys(a)).not.toContain('id');
    expect(Object.keys(a.services[0]!)).not.toContain('bufferMin');
  });

  it('matches the slug case-insensitively', async () => {
    expect((await json<PublicBusiness>(await ctx.get('/public/Arena-A'))).slug).toBe('arena-a');
  });

  it('404 for an unknown slug, 400 for an invalid one', async () => {
    expect((await ctx.get('/public/no-such-biz')).status).toBe(404);
    expect((await ctx.get('/public/x')).status).toBe(400);
  });
});

describe('public booking flow', () => {
  const TZ = 'Asia/Kuala_Lumpur';
  /** Local date n days from today (inside the 30-day booking window). */
  const day = (n: number) => formatInTimeZone(addDays(new Date(), n), TZ, 'yyyy-MM-dd');
  const at = (hhmm: string, n = 3) => `${day(n)}T${hhmm}:00+08:00`;
  const iso = (hhmm: string, n = 3) => new Date(at(hhmm, n)).toISOString();

  let court1 = 0;
  let court3 = 0;
  let free = 0; // pay at venue
  let paid = 0; // full prepayment
  let hidden = 0;
  let mobile = 0; // at customer location + required question
  let otherBizService = 0;

  const book = (body: Record<string, unknown>, slug = 'arena-a') =>
    ctx.post(`/public/${slug}/bookings`, { serviceId: free, customer: { name: 'Ali', phone: '+60123456789' }, ...body });
  const errorOf = async (res: Response) => ({
    status: res.status,
    code: ((await res.json()) as { error: { code: string } }).error.code,
  });

  beforeAll(async () => {
    const allWeek = { hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '08:00', endTime: '22:00' })) };
    const mk = async (name: string) =>
      (await json<Resource>(await ctx.send('POST', '/resources', ownerA, { name, resourceType: 'court' }), 201)).id;
    court1 = await mk('Court 1');
    const court2 = await mk('Court 2');
    court3 = await mk('Court 3 (not linked)');
    for (const id of [court1, court2, court3]) await json(await ctx.send('PUT', `/resources/${id}/working-hours`, ownerA, allWeek));
    const svc = async (body: Record<string, unknown>) =>
      (await json<Service>(await ctx.send('POST', '/services', ownerA, { durationMin: 60, resourceIds: [court1, court2], ...body }), 201)).id;
    free = await svc({ name: 'Casual court', priceSen: 2000 });
    paid = await svc({ name: 'Peak court', priceSen: 3000, prepayFull: true });
    hidden = await svc({ name: 'Members', isVisible: false });
    mobile = await svc({ name: 'Mobile inspection', locationType: 'at_customer_location', priceSen: 20000, depositSen: 5000 });
    const [a] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'arena-a'));
    await ctx.db.insert(bookingFields).values({
      businessId: a!.id,
      serviceId: mobile,
      fieldKey: 'plate_number',
      label: 'Plate number',
      fieldType: 'text',
      isRequired: true,
    });
    otherBizService = (await json<Service>(await ctx.send('POST', '/services', ownerB, { name: 'B court', durationMin: 60 }), 201)).id;
  });

  it('GET /public/:slug includes what the booking page needs, nothing internal', async () => {
    const biz = await json<PublicBusiness>(await ctx.get('/public/arena-a'));
    expect(biz).toMatchObject({ resourceLabel: expect.any(String), minAdvanceMin: 60, maxDaysAhead: 30 });
    expect(biz).not.toHaveProperty('pendingExpiryMin');
    const ids = biz.resources.map((r) => r.id);
    expect(ids).toContain(court1);
    expect(ids).not.toContain(court3); // offers no visible service
    const c1 = biz.resources.find((r) => r.id === court1)!;
    expect(c1.serviceIds).toEqual(expect.arrayContaining([free, paid, mobile]));
    expect(c1.serviceIds).not.toContain(hidden);
    expect(biz.bookingFields.find((f) => f.fieldKey === 'plate_number')).toEqual({
      serviceId: mobile,
      fieldKey: 'plate_number',
      label: 'Plate number',
      fieldType: 'text',
      options: null,
      isRequired: true,
      hint: null,
    });
  });

  it('slots respect the booking window and visibility', async () => {
    const res = await json<Availability>(await ctx.get(`/public/arena-a/slots?serviceId=${free}&date=${day(3)}`));
    expect(res.slots.map((s) => s.startAt)).toContain(iso('08:00'));
    expect((await json<Availability>(await ctx.get(`/public/arena-a/slots?serviceId=${free}&date=${day(45)}`))).slots).toEqual([]);
    expect((await json<Availability>(await ctx.get(`/public/arena-a/slots?serviceId=${free}&date=${day(-1)}`))).slots).toEqual([]);
    expect((await ctx.get(`/public/arena-a/slots?serviceId=${hidden}&date=${day(3)}`)).status).toBe(404);
    expect((await ctx.get(`/public/arena-a/slots?serviceId=${otherBizService}&date=${day(3)}`)).status).toBe(404);
    expect((await ctx.get(`/public/arena-a/slots?serviceId=${free}&date=${day(3)}&resourceId=${court3}`)).status).toBe(404);
  });

  it('books a pay-at-venue service as confirmed and returns only this booking', async () => {
    const c = await json<PublicBookingConfirmation>(await book({ startAt: at('09:00'), customFields: { players: 4 } }), 201);
    expect(c).toMatchObject({
      status: 'confirmed',
      startAt: iso('09:00'),
      serviceName: 'Casual court',
      customerName: 'Ali',
      priceSen: 2000,
      amountDueSen: 0,
      paymentStatus: 'not_required',
      expiresAt: null,
      business: { slug: 'arena-a', name: 'Arena A' },
    });
    expect(c.token).toMatch(/^[0-9a-f]{32}$/);
    expect(c).not.toHaveProperty('id');
    const owner = await json<Booking[]>(await ctx.get(`/bookings?from=${day(3)}&to=${day(4)}`, ownerA));
    expect(owner.find((b) => b.startAt === iso('09:00'))).toMatchObject({ source: 'web', status: 'confirmed', customFields: { players: 4 } });
  });

  it('a prepaid service starts pending with an expiry', async () => {
    const before = Date.now();
    const c = await json<PublicBookingConfirmation>(await book({ serviceId: paid, startAt: at('10:00') }), 201);
    expect(c).toMatchObject({ status: 'pending', amountDueSen: 3000, paymentStatus: 'unpaid' });
    const mins = (new Date(c.expiresAt!).getTime() - before) / 60_000;
    expect(mins).toBeGreaterThan(14);
    expect(mins).toBeLessThan(16);
  });

  it('only offered slots can be booked', async () => {
    expect(await errorOf(await book({ startAt: at('11:15') }))).toEqual({ status: 409, code: 'slot_taken' }); // off the grid
    expect(await errorOf(await book({ startAt: at('07:00') }))).toEqual({ status: 409, code: 'slot_taken' }); // before opening
    expect(await errorOf(await book({ startAt: at('09:00', 45) }))).toEqual({ status: 409, code: 'slot_taken' }); // beyond max days
    expect(await errorOf(await book({ startAt: at('09:00', -1) }))).toEqual({ status: 409, code: 'slot_taken' }); // past
    await json(await book({ startAt: at('12:00'), resourceId: court1 }), 201);
    expect(await errorOf(await book({ startAt: at('12:00'), resourceId: court1 }))).toEqual({ status: 409, code: 'slot_taken' });
    // "Any" still finds court 2.
    expect((await json<PublicBookingConfirmation>(await book({ startAt: at('12:00') }), 201)).resourceName).toBe('Court 2');
  });

  it('requires the address and required questions', async () => {
    const base = { serviceId: mobile, startAt: at('14:00') };
    expect(await errorOf(await book({ ...base, customFields: { plate_number: 'WXY 1234' } }))).toEqual({
      status: 400,
      code: 'address_required',
    });
    expect(await errorOf(await book({ ...base, locationAddress: 'Jalan 1, Puchong' }))).toEqual({
      status: 400,
      code: 'missing_custom_fields',
    });
    const c = await json<PublicBookingConfirmation>(
      await book({ ...base, locationAddress: 'Jalan 1, Puchong', customFields: { plate_number: 'WXY 1234' } }),
      201,
    );
    expect(c).toMatchObject({ status: 'pending', amountDueSen: 5000, locationAddress: 'Jalan 1, Puchong' });
  });

  it('never renames an existing customer, and ignores owner-only fields', async () => {
    await json(
      await ctx.send('POST', '/bookings', ownerA, {
        serviceId: free,
        resourceId: court1,
        startAt: at('16:00', 4),
        customer: { name: 'Siti Aminah', phone: '+60198765432' },
      }),
      201,
    );
    const c = await json<PublicBookingConfirmation>(
      await book({
        startAt: at('17:00', 4),
        customer: { name: 'Someone Else', phone: '+60198765432' },
        source: 'walk_in',
        allowOutsideHours: true,
      }),
      201,
    );
    expect(c.customerName).toBe('Someone Else');
    const rows = await ctx.db.select({ name: customers.name }).from(customers).where(eq(customers.phone, '+60198765432'));
    expect(rows).toEqual([{ name: 'Siti Aminah' }]);
    const owner = await json<Booking[]>(await ctx.get(`/bookings?from=${day(4)}&to=${day(5)}`, ownerA));
    expect(owner.find((b) => b.startAt === iso('17:00', 4))!.source).toBe('web');
    expect(await errorOf(await book({ startAt: at('06:00', 4), allowOutsideHours: true }))).toEqual({ status: 409, code: 'slot_taken' });
  });

  it('limits web bookings per phone per day', async () => {
    const customer = { name: 'Spam', phone: '+60111111111' };
    for (const h of ['08:00', '09:00', '10:00', '11:00', '12:00']) {
      await json(await book({ startAt: at(h, 5), customer }), 201);
    }
    expect(await errorOf(await book({ startAt: at('13:00', 5), customer }))).toEqual({ status: 429, code: 'too_many_bookings' });
  });

  it('only one of two simultaneous customers gets the slot', async () => {
    const [r1, r2] = await Promise.all([
      book({ startAt: at('20:00', 6), resourceId: court1, customer: { name: 'A', phone: '+60122222222' } }),
      book({ startAt: at('20:00', 6), resourceId: court1, customer: { name: 'B', phone: '+60133333333' } }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
  });

  it('validates input', async () => {
    expect((await book({ startAt: at('09:00', 7), customer: { name: 'X', phone: '0123' } })).status).toBe(400);
    expect((await book({ startAt: 'tomorrow' })).status).toBe(400);
    expect((await book({ serviceId: hidden, startAt: at('09:00', 7) })).status).toBe(404);
    expect((await book({ serviceId: otherBizService, startAt: at('09:00', 7) })).status).toBe(404);
    expect((await book({ startAt: at('09:00', 7) }, 'no-such-biz')).status).toBe(404);
  });

  it('pauses slots and booking when the owner switches online booking off', async () => {
    await json(await ctx.send('PATCH', '/businesses/current', ownerA, { bookingEnabled: false }));
    try {
      expect((await json<PublicBusiness>(await ctx.get('/public/arena-a'))).bookingEnabled).toBe(false);
      expect(await errorOf(await ctx.get(`/public/arena-a/slots?serviceId=${free}&date=${day(3)}`))).toEqual({
        status: 403,
        code: 'booking_disabled',
      });
      expect(await errorOf(await book({ startAt: at('15:00') }))).toEqual({ status: 403, code: 'booking_disabled' });
    } finally {
      await json(await ctx.send('PATCH', '/businesses/current', ownerA, { bookingEnabled: true }));
    }
  });
});
