import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, addMinutes } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { and, eq } from 'drizzle-orm';
import { bookingEvents, bookings, businesses, notifications, payments, pushTokens, subscriptions, users } from '@outletbooking/db';
import type { PublicAvailability, PublicBookingConfirmation, Resource, Service } from '@outletbooking/shared';
import { Outbox } from '../src/services/notifications';
import { createPaymentDeps } from '../src/services/payments';
import { expireUnpaidBookings, sendDaySummaries, sendTrialReminders } from '../src/services/scheduled';
import { createTestContext, signupInput } from './helpers';

/** Phase 5 background jobs, called directly (pg-boss only schedules them). */
const ctx = createTestContext();
const deps = createPaymentDeps(ctx.env, ctx.toyyibpay);
const TZ = 'Asia/Kuala_Lumpur';
let owner = '';
let court = 0;
let svc = 0;
let bizId = 0;
let n = 0;

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const day = (d: number) => formatInTimeZone(addDays(new Date(), d), TZ, 'yyyy-MM-dd');
async function book(d: number) {
  const slots = await json<PublicAvailability>(await ctx.get(`/public/job-a/slots?serviceId=${svc}&date=${day(d)}`));
  const slot = slots.slots[n++]!;
  const c = await json<PublicBookingConfirmation>(
    await ctx.post('/public/job-a/bookings', { serviceId: svc, startAt: slot.startAt, customer: { name: 'Lee', phone: `+60125550${String(n).padStart(3, '0')}` } }),
    201,
  );
  const [row] = await ctx.db.select({ id: bookings.id }).from(bookings).where(eq(bookings.publicToken, c.token));
  return { id: row!.id, token: c.token };
}
const eventsOf = async (id: number) =>
  (await ctx.db.select({ type: bookingEvents.eventType }).from(bookingEvents).where(eq(bookingEvents.bookingId, id))).map((e) => e.type);

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'job-a' }))).status).toBe(201);
  owner = await ctx.login('a@example.com', 'password123');
  court = (await json<Resource>(await ctx.send('POST', '/resources', owner, { name: 'Court 1', resourceType: 'court' }), 201)).id;
  await json(
    await ctx.send('PUT', `/resources/${court}/working-hours`, owner, {
      hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '06:00', endTime: '23:00' })),
    }),
  );
  svc = (await json<Service>(await ctx.send('POST', '/services', owner, { name: 'Court hire', durationMin: 60, priceSen: 2000, prepayFull: true, resourceIds: [court] }), 201)).id;
  bizId = await ctx.connectOnlinePayments('job-a');
});
afterAll(() => ctx.close());

describe('expire unpaid bookings', () => {
  it('releases pending bookings past their hold — after re-checking ToyyibPay', async () => {
    const unpaid = await book(2);
    const paidButNoCallback = await book(2);
    const fresh = await book(2);
    await ctx.post(`/public/bookings/${unpaid.token}/pay`, {});
    const bill = ((await json<{ url: string }>(await ctx.post(`/public/bookings/${paidButNoCallback.token}/pay`, {}))).url).split('/').at(-1)!;
    ctx.toyyibpay.pay(bill); // paid, but the callback never arrived

    const later = addMinutes(new Date(), 20); // holds are 15 min
    await ctx.db.update(bookings).set({ expiresAt: addMinutes(new Date(), 30) }).where(eq(bookings.id, fresh.id));
    const outbox = new Outbox();
    expect(await expireUnpaidBookings(ctx.db, deps, outbox, later)).toBe(1);

    const status = async (id: number) => (await ctx.db.select({ s: bookings.status, r: bookings.cancelReason }).from(bookings).where(eq(bookings.id, id)))[0];
    expect(await status(unpaid.id)).toEqual({ s: 'cancelled', r: 'Not paid in time' });
    expect(await eventsOf(unpaid.id)).toContain('expired');
    expect((await ctx.db.select({ s: payments.status }).from(payments).where(eq(payments.bookingId, unpaid.id)))[0]!.s).toBe('expired');
    expect((await status(paidButNoCallback.id))!.s).toBe('confirmed');
    expect((await status(fresh.id))!.s).toBe('pending');

    const notes = await ctx.db.select({ title: notifications.title }).from(notifications).where(eq(notifications.bookingId, unpaid.id));
    expect(notes.map((x) => x.title)).toContain('Not paid in time — slot released');
    // Running again changes nothing.
    expect(await expireUnpaidBookings(ctx.db, deps, new Outbox(), later)).toBe(0);
    // The slot is free again for others.
    const slots = await json<PublicAvailability>(await ctx.get(`/public/job-a/slots?serviceId=${svc}&date=${day(2)}`));
    const [orig] = await ctx.db.select({ startAt: bookings.startAt }).from(bookings).where(eq(bookings.id, unpaid.id));
    expect(slots.slots.map((x) => x.startAt)).toContain(orig!.startAt.toISOString());
  });
});

describe('morning summary push', () => {
  it('at 7 AM local time, to members with a phone registered', async () => {
    const [u] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, 'a@example.com'));
    await ctx.db.insert(pushTokens).values({ userId: u!.id, token: 'ExponentPushToken[owner]', platform: 'ios' });
    const b = await book(1); // tomorrow
    await ctx.db.update(bookings).set({ status: 'confirmed', expiresAt: null }).where(eq(bookings.id, b.id));
    const tomorrow7am = fromZonedTime(`${day(1)}T07:05:00`, TZ);
    ctx.pushed.length = 0;
    expect(await sendDaySummaries(ctx.db, ctx.push, tomorrow7am)).toBe(1);
    expect(ctx.pushed[0]).toMatchObject({ to: 'ExponentPushToken[owner]', title: 'Today: 1 booking', body: expect.stringMatching(/^First at /) });
    // Not at 9 AM.
    expect(await sendDaySummaries(ctx.db, ctx.push, addMinutes(tomorrow7am, 120))).toBe(0);
  });
});

describe('trial reminders', () => {
  it('day 5 "ends in 2 days", then "ended" — once each', async () => {
    const now = new Date();
    await ctx.db.update(subscriptions).set({ trialEndsAt: addDays(now, 2) }).where(eq(subscriptions.businessId, bizId));
    expect(await sendTrialReminders(ctx.db, new Outbox(), now)).toBe(1);
    expect(await sendTrialReminders(ctx.db, new Outbox(), now)).toBe(0);
    await ctx.db.update(subscriptions).set({ trialEndsAt: addMinutes(now, -5) }).where(eq(subscriptions.businessId, bizId));
    expect(await sendTrialReminders(ctx.db, new Outbox(), now)).toBe(1);
    const rows = await ctx.db
      .select({ type: notifications.type, title: notifications.title })
      .from(notifications)
      .where(and(eq(notifications.businessId, bizId)));
    expect(rows.filter((r) => r.type.startsWith('trial'))).toEqual([
      { type: 'trial_ending', title: 'Free trial ends in 2 days' },
      { type: 'trial_ended', title: 'Your free trial has ended' },
    ]);
    // Paid plans get nothing.
    await ctx.db.update(subscriptions).set({ status: 'active' }).where(eq(subscriptions.businessId, bizId));
    await ctx.db.delete(notifications).where(eq(notifications.businessId, bizId));
    expect(await sendTrialReminders(ctx.db, new Outbox(), now)).toBe(0);
    expect(await ctx.db.select().from(businesses).where(eq(businesses.id, bizId))).toHaveLength(1);
  });
});
