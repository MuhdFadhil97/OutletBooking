import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { bookings, businesses, businessMembers, refunds } from '@outletbooking/db';
import type { Booking, BookingEvent, Resource, Service } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

/** D4 · cancel with reason and optional refund (recorded only). */
const ctx = createTestContext();
let owner = '';
let ownerB = '';
let staff = '';
let court = 0;
let deposit = 0; // RM 100, RM 30 deposit online
let slot = 0;

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const at = () => `2026-11-${String(2 + Math.floor(slot / 10)).padStart(2, '0')}T${String(8 + (slot++ % 10)).padStart(2, '0')}:00:00+08:00`;

/** A confirmed booking whose online deposit has been paid. */
async function paidBooking(): Promise<Booking> {
  const b = await json<Booking>(
    await ctx.send('POST', '/bookings', owner, { serviceId: deposit, resourceId: court, startAt: at(), customer: { name: 'Hafiz', phone: '+60132221188' } }),
    201,
  );
  await ctx.db.update(bookings).set({ paymentStatus: 'paid' }).where(eq(bookings.id, b.id));
  return b;
}
const cancel = (id: number, body: object, cookie = owner) => ctx.send('POST', `/bookings/${id}/cancel`, cookie, body);

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'refund-a' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'refund-b' }))).status).toBe(201);
  owner = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');
  const [biz] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'refund-a'));
  const staffId = await ctx.createUser('Siti', 'siti@example.com');
  await ctx.db.insert(businessMembers).values({ businessId: biz!.id, userId: staffId, role: 'staff', canViewAll: true, canTakePayments: true });
  staff = await ctx.login('siti@example.com', 'password123');

  court = (await json<Resource>(await ctx.send('POST', '/resources', owner, { name: 'Bay 1', resourceType: 'bay' }), 201)).id;
  await json(
    await ctx.send('PUT', `/resources/${court}/working-hours`, owner, {
      hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '08:00', endTime: '22:00' })),
    }),
  );
  deposit = (
    await json<Service>(
      await ctx.send('POST', '/services', owner, { name: 'Inspection', durationMin: 60, priceSen: 10000, depositSen: 3000, resourceIds: [court] }),
      201,
    )
  ).id;
});
afterAll(() => ctx.close());

describe('POST /bookings/:id/cancel', () => {
  it('cancel without refund: reason stored, one event, deposit kept', async () => {
    const b = await paidBooking();
    const out = await json<Booking>(await cancel(b.id, { reason: 'Customer asked' }));
    expect(out).toMatchObject({ status: 'cancelled', cancelReason: 'Customer asked', paymentStatus: 'paid', refundedSen: 0 });
    const events = await json<BookingEvent[]>(await ctx.get(`/bookings/${b.id}/events`, owner));
    expect(events.map((e) => e.type)).toEqual(['created', 'cancelled']);
  });

  it('full refund: refund row, cancelled + refunded events, booking marked refunded', async () => {
    const b = await paidBooking();
    const out = await json<Booking>(await cancel(b.id, { reason: 'We’re closed', refund: { amountSen: 3000, method: 'duitnow' } }));
    expect(out).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded', refundedSen: 3000 });
    const [row] = await ctx.db.select().from(refunds).where(eq(refunds.bookingId, b.id));
    expect(row).toMatchObject({ amountSen: 3000, method: 'duitnow', reason: 'We’re closed' });
    const events = await json<BookingEvent[]>(await ctx.get(`/bookings/${b.id}/events`, owner));
    expect(events.map((e) => e.type)).toEqual(['created', 'cancelled', 'refunded']);
    expect(events[2]).toMatchObject({ details: { amountSen: 3000, method: 'duitnow' }, actor: { name: 'Ali Hassan' } });
  });

  it('partial refund keeps the booking "paid"', async () => {
    const b = await paidBooking();
    const out = await json<Booking>(await cancel(b.id, { refund: { amountSen: 1000, method: 'cash' } }));
    expect(out).toMatchObject({ paymentStatus: 'paid', refundedSen: 1000 });
  });

  it('cannot refund more than was paid, or an unpaid booking; nothing is cancelled then', async () => {
    const b = await paidBooking();
    const tooMuch = await cancel(b.id, { refund: { amountSen: 3001, method: 'cash' } });
    expect(tooMuch.status).toBe(400);
    expect(await errorCode(tooMuch)).toBe('refund_too_large');
    expect((await json<Booking>(await ctx.get(`/bookings/${b.id}`, owner))).status).toBe('confirmed');

    const unpaid = await json<Booking>(
      await ctx.send('POST', '/bookings', owner, { serviceId: deposit, resourceId: court, startAt: at(), customer: { name: 'Lee', phone: '+60139998877' } }),
      201,
    );
    const res = await cancel(unpaid.id, { refund: { amountSen: 100, method: 'cash' } });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('nothing_to_refund');
    expect(await ctx.db.select().from(refunds).where(eq(refunds.bookingId, unpaid.id))).toHaveLength(0);
  });

  it('already cancelled / completed bookings are refused', async () => {
    const b = await paidBooking();
    await json(await cancel(b.id, {}));
    expect((await cancel(b.id, {})).status).toBe(409);
  });

  it('validates the refund method and amount', async () => {
    const b = await paidBooking();
    expect((await cancel(b.id, { refund: { amountSen: 100, method: 'card' } })).status).toBe(400);
    expect((await cancel(b.id, { refund: { amountSen: 0, method: 'cash' } })).status).toBe(400);
  });

  it('owner only; other businesses get 404', async () => {
    const b = await paidBooking();
    expect((await cancel(b.id, {}, staff)).status).toBe(403);
    expect((await cancel(b.id, {}, ownerB)).status).toBe(404);
    expect((await json<Booking>(await ctx.get(`/bookings/${b.id}`, owner))).status).toBe('confirmed');
  });
});

describe('booking detail extras', () => {
  it('ref and visit count', async () => {
    const first = await paidBooking();
    const second = await paidBooking();
    expect(first.ref).toMatch(/^[0-9A-F]{4}$/);
    const fresh = await json<Booking>(await ctx.get(`/bookings/${second.id}`, owner));
    expect(fresh.customer.bookingCount).toBeGreaterThanOrEqual(2);
  });
});
