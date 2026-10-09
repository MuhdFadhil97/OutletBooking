import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { and, eq } from 'drizzle-orm';
import { bookingEvents, businessMembers, notifications, payments, refunds, users } from '@outletbooking/db';
import type {
  Booking,
  BookingEvent,
  NotificationList,
  PublicBookingConfirmation,
  Resource,
  Service,
  StaffInvitation,
  StaffListResponse,
} from '@outletbooking/shared';
import { settleBackground } from '../src/background';
import { createTestContext, signupInput } from './helpers';

/** Extend + refunds (Phase 3), notifications and next available (Phase 4). */
const ctx = createTestContext();
const TZ = 'Asia/Kuala_Lumpur';
const day = (n: number) => formatInTimeZone(addDays(new Date(), n), TZ, 'yyyy-MM-dd');
const at = (hhmm: string, n = 3) => `${day(n)}T${hhmm}:00+08:00`;

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const errorOf = async (res: Response) => ({
  status: res.status,
  code: ((await res.json()) as { error: { code: string } }).error.code,
});

let ownerA = '';
let ownerB = '';
let staffLinked = '';
let staffOther = '';
let businessA = 0;
let court1 = 0;
let court2 = 0;
let svc = 0;

let phoneSeq = 0;
const nextPhone = () => `+6012400${String(++phoneSeq).padStart(4, '0')}`;
const ownerBook = (startAt: string, body: Record<string, unknown> = {}) =>
  ctx.send('POST', '/bookings', ownerA, {
    serviceId: svc,
    resourceId: court1,
    startAt,
    customer: { name: 'Ali', phone: nextPhone() },
    ...body,
  });
const events = async (id: number, cookie = ownerA) =>
  (await json<BookingEvent[]>(await ctx.get(`/bookings/${id}/events`, cookie))).map((e) => e.type);

async function staffFor(email: string, resourceId: number, perms: Record<string, boolean> = {}) {
  const inv = await json<StaffInvitation>(
    await ctx.send('POST', '/staff/invitations', ownerA, { email, resourceId, ...perms }),
    201,
  );
  const token = inv.inviteUrl.split('/invite/')[1]!;
  await json(await ctx.post(`/invitations/${token}/accept`, { name: email, phone: '+60111222333', password: 'password123' }));
  return ctx.login(email, 'password123');
}

async function memberIdOf(email: string) {
  const list = await json<StaffListResponse>(await ctx.get('/staff', ownerA));
  return list.members.find((m) => m.email === email)!.memberId;
}

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'act-a' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'act-b' }))).status).toBe(201);
  ownerA = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');
  const [ownerUser] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, 'a@example.com'));
  const [m] = await ctx.db
    .select({ businessId: businessMembers.businessId })
    .from(businessMembers)
    .where(eq(businessMembers.userId, ownerUser!.id));
  businessA = m!.businessId;

  const allWeek = { hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '08:00', endTime: '22:00' })) };
  const mk = async (name: string) => {
    const id = (await json<Resource>(await ctx.send('POST', '/resources', ownerA, { name, resourceType: 'court' }), 201)).id;
    await json(await ctx.send('PUT', `/resources/${id}/working-hours`, ownerA, allWeek));
    return id;
  };
  court1 = await mk('Court 1');
  court2 = await mk('Court 2');
  svc = (
    await json<Service>(
      await ctx.send('POST', '/services', ownerA, {
        name: 'Court hire',
        durationMin: 60,
        durationOptions: [60, 120],
        priceUnit: 'per_block',
        priceSen: 2000,
        resourceIds: [court1, court2],
      }),
      201,
    )
  ).id;
  staffLinked = await staffFor('linked@example.com', court1);
  staffOther = await staffFor('other@example.com', court2);
});
afterAll(() => ctx.close());

describe('extend (H8)', () => {
  it('adds one block, re-prices and logs it', async () => {
    const b = await json<Booking>(await ownerBook(at('14:00', 4)), 201);
    await json(await ctx.send('POST', `/bookings/${b.id}/status`, ownerA, { status: 'checked_in' }));
    const ext = await json<Booking>(await ctx.send('POST', `/bookings/${b.id}/extend`, ownerA, {}));
    expect(ext).toMatchObject({ durationMin: 120, priceSen: 4000, endAt: new Date(at('16:00', 4)).toISOString() });
    expect((await events(b.id)).slice(-1)).toEqual(['extended']);

    // 180 min is not offered.
    expect(await errorOf(await ctx.send('POST', `/bookings/${b.id}/extend`, ownerA, {}))).toEqual({
      status: 409,
      code: 'not_extendable',
    });
  });

  it('cannot run into the next booking; staff cannot extend', async () => {
    const b = await json<Booking>(await ownerBook(at('09:00', 4)), 201);
    await json(await ownerBook(at('10:00', 4)), 201);
    expect(await errorOf(await ctx.send('POST', `/bookings/${b.id}/extend`, ownerA, {}))).toEqual({
      status: 409,
      code: 'slot_taken',
    });
    expect((await ctx.send('POST', `/bookings/${b.id}/extend`, staffLinked, {})).status).toBe(403);
  });
});

describe('cancel with refund (D4)', () => {
  async function paidBooking(startAt: string, paidSen: number) {
    const b = await json<Booking>(await ownerBook(startAt), 201);
    await ctx.db.insert(payments).values({
      businessId: businessA,
      bookingId: b.id,
      purpose: 'deposit',
      provider: 'toyyibpay',
      method: 'fpx',
      amountSen: paidSen,
      status: 'paid',
      paidAt: new Date(),
    });
    return b;
  }

  it('shows what was paid on the booking', async () => {
    const b = await paidBooking(at('08:00', 5), 1500);
    expect(await json<Booking>(await ctx.get(`/bookings/${b.id}`, ownerA))).toMatchObject({ paidSen: 1500, refundedSen: 0 });
  });

  it('refuses more than was paid, and refunds on unpaid bookings', async () => {
    const b = await paidBooking(at('09:00', 5), 1500);
    const res = await ctx.send('POST', `/bookings/${b.id}/status`, ownerA, {
      status: 'cancelled',
      refund: { amountSen: 1501, method: 'duitnow' },
    });
    expect(await errorOf(res)).toEqual({ status: 400, code: 'refund_too_large' });
    // Nothing changed.
    expect((await json<Booking>(await ctx.get(`/bookings/${b.id}`, ownerA))).status).toBe('confirmed');

    const unpaid = await json<Booking>(await ownerBook(at('10:00', 5)), 201);
    expect(
      await errorOf(
        await ctx.send('POST', `/bookings/${unpaid.id}/status`, ownerA, {
          status: 'cancelled',
          refund: { amountSen: 100, method: 'cash' },
        }),
      ),
    ).toEqual({ status: 400, code: 'refund_too_large' });
    // A refund only goes with a cancellation.
    expect(
      (await ctx.send('POST', `/bookings/${b.id}/status`, ownerA, { status: 'no_show', refund: { amountSen: 100, method: 'cash' } }))
        .status,
    ).toBe(400);
  });

  it('partial refund keeps "paid"; full refund marks it refunded', async () => {
    const partial = await paidBooking(at('11:00', 5), 2000);
    const p = await json<Booking>(
      await ctx.send('POST', `/bookings/${partial.id}/status`, ownerA, {
        status: 'cancelled',
        reason: 'Customer asked',
        refund: { amountSen: 500, method: 'bank_transfer' },
      }),
    );
    expect(p).toMatchObject({ status: 'cancelled', paidSen: 2000, refundedSen: 500 });
    expect(await events(partial.id)).toEqual(['created', 'refunded', 'cancelled']);

    const full = await paidBooking(at('12:00', 5), 2000);
    const f = await json<Booking>(
      await ctx.send('POST', `/bookings/${full.id}/status`, ownerA, {
        status: 'cancelled',
        refund: { amountSen: 2000, method: 'duitnow' },
      }),
    );
    expect(f).toMatchObject({ paymentStatus: 'refunded', refundedSen: 2000 });
    const [row] = await ctx.db.select().from(refunds).where(eq(refunds.bookingId, full.id));
    expect(row).toMatchObject({ amountSen: 2000, method: 'duitnow', paymentId: expect.any(Number) });
  });

  it('keep deposit = cancel without a refund', async () => {
    const b = await paidBooking(at('13:00', 5), 1000);
    const res = await json<Booking>(await ctx.send('POST', `/bookings/${b.id}/status`, ownerA, { status: 'cancelled' }));
    expect(res).toMatchObject({ paidSen: 1000, refundedSen: 0, paymentStatus: b.paymentStatus });
  });
});

describe('notifications (D6)', () => {
  beforeEach(async () => {
    await ctx.db.delete(notifications);
  });

  const list = async (cookie: string) => json<NotificationList>(await ctx.get('/notifications', cookie));

  it('a web booking notifies the owner and the linked staff, each in their own list', async () => {
    await json(
      await ctx.post('/public/act-a/bookings', {
        serviceId: svc,
        resourceId: court1,
        startAt: at('15:00', 6),
        customer: { name: 'Aina', phone: nextPhone() },
      }),
      201,
    );
    await settleBackground();

    const owner = await list(ownerA);
    expect(owner.unreadCount).toBe(1);
    expect(owner.items[0]).toMatchObject({ type: 'booking_new', title: 'New booking', read: false, bookingId: expect.any(Number) });
    expect(owner.items[0]!.body).toContain('Aina · Court hire');
    expect((await list(staffLinked)).unreadCount).toBe(1);
    expect((await list(staffOther)).items).toEqual([]);
    expect((await list(ownerB)).items).toEqual([]);
  });

  it('mark read touches only the caller’s own rows', async () => {
    await json(
      await ctx.post('/public/act-a/bookings', {
        serviceId: svc,
        resourceId: court1,
        startAt: at('16:00', 6),
        customer: { name: 'Aina', phone: nextPhone() },
      }),
      201,
    );
    await settleBackground();
    const staffItem = (await list(staffLinked)).items[0]!;

    // Owner B tries to mark staff's row: ignored.
    expect((await ctx.send('POST', '/notifications/read', ownerB, { ids: [staffItem.id] })).status).toBe(204);
    expect((await list(staffLinked)).unreadCount).toBe(1);

    expect((await ctx.send('POST', '/notifications/read', ownerA, {})).status).toBe(204);
    expect((await list(ownerA)).unreadCount).toBe(0);
    expect((await list(staffLinked)).unreadCount).toBe(1);

    expect((await ctx.send('POST', '/notifications/read', staffLinked, { ids: [staffItem.id] })).status).toBe(204);
    expect(await list(staffLinked)).toMatchObject({ unreadCount: 0, items: [{ read: true }] });
    expect((await ctx.get('/notifications')).status).toBe(401);
  });

  it('accepting an invite tells the owner', async () => {
    await staffFor('kevin@example.com', court2);
    await settleBackground();
    const owner = await list(ownerA);
    expect(owner.items[0]).toMatchObject({ type: 'staff_joined', title: 'kevin@example.com joined your team' });
  });
});

describe('next available (F2)', () => {
  it('lists the first free times after a fully booked day, within the booking window', async () => {
    type Next = { startAt: string; resourceId: number; resourceName: string }[];
    const q = (date: string, extra = '') =>
      ctx.get(`/public/act-a/next-available?serviceId=${svc}&date=${date}&resourceId=${court1}${extra}`);
    const next = await json<Next>(await q(day(8)));
    expect(next).toHaveLength(3);
    expect(next.map((s) => s.startAt)).toEqual(
      [at('08:00', 9), at('09:00', 9), at('10:00', 9)].map((x) => new Date(x).toISOString()),
    );
    expect(next[0]).toMatchObject({ resourceId: court1, resourceName: 'Court 1' });
    expect(await json<Next>(await q(day(8), '&limit=1'))).toHaveLength(1);
    // Last day of the window (30 days by default): nothing after it.
    expect(await json<Next>(await q(day(30)))).toEqual([]);
    expect((await ctx.get(`/public/act-b/next-available?serviceId=${svc}&date=${day(8)}`)).status).toBe(404);
  });
});
