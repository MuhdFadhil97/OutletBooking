import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { and, eq } from 'drizzle-orm';
import {
  bookingEvents,
  bookings,
  businesses,
  notifications,
  paymentAccounts,
  payments,
  subscriptions,
  users,
} from '@outletbooking/db';
import type {
  Booking,
  PaymentAccountInfo,
  PaymentLink,
  PublicBookingConfirmation,
  Resource,
  Service,
  StaffInvitation,
} from '@outletbooking/shared';
import { settleBackground } from '../src/background';
import { staffDaySummary, trialReminders } from '../src/services/daily';
import { expirePendingBookings, notifyExpired, syncBill, type PaymentDeps } from '../src/services/payments';
import { decryptSecret } from '../src/services/secrets';
import { callbackHash } from '../src/services/toyyibpay';
import { createTestContext, signupInput } from './helpers';

/** Phase 5: own ToyyibPay per business, bills, callback re-check, manual payments, expiry, reminders, daily jobs. */
const ctx = createTestContext();
const TZ = 'Asia/Kuala_Lumpur';
const day = (n: number) => formatInTimeZone(addDays(new Date(), n), TZ, 'yyyy-MM-dd');
const at = (hhmm: string, n = 3) => `${day(n)}T${hhmm}:00+08:00`;
const KEY = 'abcd1234-efgh-5678';

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
let staff = '';
let businessA = 0;
let court1 = 0;
let court2 = 0;
let deposit = 0; // RM 60 per hour, RM 20 deposit
let svcB = 0;

const deps = (): PaymentDeps => ({ db: ctx.db, env: ctx.env, toyyibpay: ctx.toyyibpay, push: { send: async (m) => m.map(() => ({ status: 'ok', id: 'x' })) } });

let phoneSeq = 0;
const book = (slug: string, serviceId: number, startAt: string, resourceId = court1) =>
  ctx.post(`/public/${slug}/bookings`, {
    serviceId,
    resourceId,
    startAt,
    customer: { name: 'Aina', phone: `+6012500${String(++phoneSeq).padStart(4, '0')}` },
  });
const pay = (token: string) => ctx.post(`/public/bookings/${token}/pay`, {});
const callback = (form: Record<string, string>) =>
  ctx.app.request('/toyyibpay/callback', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
const billOf = (url: string) => url.split('/').pop()!;
const bookingRow = async (token: string) =>
  (await ctx.db.select().from(bookings).where(eq(bookings.publicToken, token)))[0]!;
const eventTypes = async (bookingId: number) =>
  (await ctx.db.select({ t: bookingEvents.eventType }).from(bookingEvents).where(eq(bookingEvents.bookingId, bookingId))).map(
    (e) => e.t,
  );

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'pay-a', businessName: 'Arena A' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'pay-b' }))).status).toBe(201);
  ownerA = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');
  const [biz] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'pay-a'));
  businessA = biz!.id;

  const allWeek = { hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '08:00', endTime: '22:00' })) };
  const mk = async (cookie: string, name: string) => {
    const id = (await json<Resource>(await ctx.send('POST', '/resources', cookie, { name, resourceType: 'court' }), 201)).id;
    await json(await ctx.send('PUT', `/resources/${id}/working-hours`, cookie, allWeek));
    return id;
  };
  court1 = await mk(ownerA, 'Court 1');
  court2 = await mk(ownerA, 'Court 2');
  deposit = (
    await json<Service>(
      await ctx.send('POST', '/services', ownerA, {
        name: 'Court hire',
        durationMin: 60,
        priceSen: 6000,
        depositSen: 2000,
        resourceIds: [court1, court2],
      }),
      201,
    )
  ).id;
  const courtB = await mk(ownerB, 'B Court');
  svcB = (
    await json<Service>(
      await ctx.send('POST', '/services', ownerB, { name: 'B hire', durationMin: 60, priceSen: 3000, prepayFull: true, resourceIds: [courtB] }),
      201,
    )
  ).id;

  const inv = await json<StaffInvitation>(
    await ctx.send('POST', '/staff/invitations', ownerA, { email: 'staff@example.com', resourceId: court1, canTakePayments: false }),
    201,
  );
  await json(await ctx.post(`/invitations/${inv.inviteUrl.split('/invite/')[1]}/accept`, { name: 'Staff Siti', phone: '+60111222333', password: 'password123' }));
  staff = await ctx.login('staff@example.com', 'password123');
});
afterAll(() => ctx.close());

describe('H1 · connect own ToyyibPay', () => {
  it('starts not connected; only the owner can see or change it', async () => {
    expect(await json<PaymentAccountInfo>(await ctx.get('/payments/account', ownerA))).toMatchObject({ status: 'not_connected', testedAt: null });
    expect((await ctx.get('/payments/account', staff)).status).toBe(403);
    expect((await ctx.send('POST', '/payments/account', staff, { secretKey: KEY })).status).toBe(403);
  });

  it('a key ToyyibPay rejects is not saved', async () => {
    expect(await errorOf(await ctx.send('POST', '/payments/account', ownerA, { secretKey: 'bad-key-0000' }))).toEqual({
      status: 400,
      code: 'toyyibpay_rejected',
    });
    expect(await ctx.db.select().from(paymentAccounts)).toHaveLength(0);
  });

  it('connects: category created, key stored encrypted and never returned', async () => {
    const res = await ctx.send('POST', '/payments/account', ownerA, { secretKey: KEY });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text)).toMatchObject({ status: 'connected', secretKeyLast4: '5678', testPending: false });
    expect(ctx.toyyibpay.categories.at(-1)).toEqual({ key: KEY, name: 'OutletBooking Arena A' });

    const [row] = await ctx.db.select().from(paymentAccounts).where(eq(paymentAccounts.businessId, businessA));
    expect(row!.secretKeyEncrypted).not.toContain(KEY);
    expect(decryptSecret(row!.secretKeyEncrypted!, ctx.env.APP_ENCRYPTION_KEY)).toBe(KEY);

    const checklist = await json<{ steps: { key: string; done: boolean }[] }>(await ctx.get('/businesses/current/checklist', ownerA));
    expect(checklist.steps.find((s) => s.key === 'payments')?.done).toBe(true);
  });

  it('RM 1.00 test payment: pending until ToyyibPay confirms it', async () => {
    const link = await json<PaymentLink>(await ctx.send('POST', '/payments/account/test', ownerA));
    expect(link.amountSen).toBe(100);
    const code = billOf(link.paymentUrl);
    expect(ctx.toyyibpay.bills.get(code)!.input).toMatchObject({ userSecretKey: KEY, amountSen: 100, callbackUrl: 'https://api.test/toyyibpay/callback' });

    expect(await json<PaymentAccountInfo>(await ctx.send('POST', '/payments/account/test/check', ownerA))).toMatchObject({ testedAt: null, testPending: true });
    ctx.toyyibpay.pay(code);
    const info = await json<PaymentAccountInfo>(await ctx.send('POST', '/payments/account/test/check', ownerA));
    expect(info.testedAt).not.toBeNull();
    expect(info.testPending).toBe(false);
  });
});

describe('customer pays online (FR-09)', () => {
  let b: PublicBookingConfirmation;
  let code = '';

  beforeEach(() => {
    ctx.pushes.length = 0;
  });

  it('a deposit booking is pending and can be paid online', async () => {
    b = await json<PublicBookingConfirmation>(await book('pay-a', deposit, at('10:00')), 201);
    expect(b).toMatchObject({ status: 'pending', amountDueSen: 2000, paymentStatus: 'unpaid', canPayOnline: true, ref: b.token.slice(0, 6).toUpperCase() });
    const link = await json<PaymentLink>(await pay(b.token));
    code = billOf(link.paymentUrl);
    expect(link).toMatchObject({ amountSen: 2000, expiresAt: b.expiresAt });
    expect(ctx.toyyibpay.bills.get(code)!.input).toMatchObject({
      userSecretKey: KEY,
      amountSen: 2000,
      externalReferenceNo: b.ref,
      returnUrl: `http://localhost:8081/my-booking/${b.token}`,
      billTo: 'Aina',
    });
    // "Try again" reuses the same open bill.
    expect(billOf((await json<PaymentLink>(await pay(b.token))).paymentUrl)).toBe(code);
  });

  it('a forged "paid" callback changes nothing: ToyyibPay is asked first', async () => {
    expect(await (await callback({ billcode: code, status: '1', order_id: b.ref, refno: 'X', hash: 'nope' })).text()).toBe('OK');
    expect(await bookingRow(b.token)).toMatchObject({ status: 'pending', paymentStatus: 'unpaid' });
  });

  it('a real payment confirms the booking once, however many callbacks arrive', async () => {
    ctx.toyyibpay.pay(code);
    const hash = callbackHash(KEY, '1', b.ref, 'TP1');
    for (let i = 0; i < 2; i++) {
      expect(await (await callback({ billcode: code, status: '1', order_id: b.ref, refno: 'TP1', hash })).text()).toBe('OK');
    }
    await settleBackground();
    const row = await bookingRow(b.token);
    expect(row).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', expiresAt: null });
    expect(await ctx.db.select().from(payments).where(and(eq(payments.bookingId, row.id), eq(payments.status, 'paid')))).toHaveLength(1);
    expect(await eventTypes(row.id)).toEqual(['created', 'paid', 'confirmed']);

    const [n] = await ctx.db.select().from(notifications).where(and(eq(notifications.bookingId, row.id), eq(notifications.type, 'booking_paid')));
    expect(n?.title).toBe('Booking paid · RM 20.00');
    const owner = await json<Booking>(await ctx.get(`/bookings/${row.id}`, ownerA));
    expect(owner).toMatchObject({ paidSen: 2000, paymentStatus: 'paid' });
    // Nothing left to pay online.
    expect(await errorOf(await pay(b.token))).toEqual({ status: 409, code: 'nothing_to_pay' });
  });

  it('back from ToyyibPay without a callback (local dev): payment-check confirms it', async () => {
    const c = await json<PublicBookingConfirmation>(await book('pay-a', deposit, at('11:00')), 201);
    const bill = billOf((await json<PaymentLink>(await pay(c.token))).paymentUrl);
    ctx.toyyibpay.pay(bill);
    const after = await json<PublicBookingConfirmation>(await ctx.post(`/public/bookings/${c.token}/payment-check`, {}));
    expect(after).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', canPayOnline: false });
  });

  it('underpaid bills are not marked paid', async () => {
    const c = await json<PublicBookingConfirmation>(await book('pay-a', deposit, at('12:00')), 201);
    const bill = billOf((await json<PaymentLink>(await pay(c.token))).paymentUrl);
    ctx.toyyibpay.pay(bill, 1000);
    await callback({ billcode: bill });
    expect(await bookingRow(c.token)).toMatchObject({ status: 'pending', paymentStatus: 'unpaid' });
  });

  it('"confirm paid bookings myself": paid but stays pending, hold cleared', async () => {
    await ctx.db.update(businesses).set({ autoConfirmPaid: false }).where(eq(businesses.id, businessA));
    const c = await json<PublicBookingConfirmation>(await book('pay-a', deposit, at('13:00')), 201);
    const bill = billOf((await json<PaymentLink>(await pay(c.token))).paymentUrl);
    ctx.toyyibpay.pay(bill);
    await callback({ billcode: bill });
    expect(await bookingRow(c.token)).toMatchObject({ status: 'pending', paymentStatus: 'paid', expiresAt: null });
    await ctx.db.update(businesses).set({ autoConfirmPaid: true }).where(eq(businesses.id, businessA));
  });

  it('a business without ToyyibPay connected cannot take online payment', async () => {
    const c = await json<PublicBookingConfirmation>(
      await ctx.post('/public/pay-b/bookings', { serviceId: svcB, startAt: at('10:00'), customer: { name: 'Ali', phone: '+60129990001' } }),
      201,
    );
    expect(c.canPayOnline).toBe(false);
    expect(await errorOf(await pay(c.token))).toEqual({ status: 409, code: 'payments_not_connected' });
  });
});

describe('unpaid hold expiry (BR-04 job)', () => {
  it('releases the slot, expires the bill and tells the owner', async () => {
    const c = await json<PublicBookingConfirmation>(await book('pay-a', deposit, at('15:00')), 201);
    const bill = billOf((await json<PaymentLink>(await pay(c.token))).paymentUrl);
    const later = new Date(Date.parse(c.expiresAt!) + 1000);

    const expired = await expirePendingBookings(deps(), later);
    const row = await bookingRow(c.token);
    expect(expired).toContain(row.id);
    expect(row).toMatchObject({ status: 'cancelled', cancelReason: 'payment_timeout' });
    expect((await ctx.db.select().from(payments).where(eq(payments.billCode, bill)))[0]!.status).toBe('expired');
    expect((await eventTypes(row.id)).at(-1)).toBe('expired');

    await notifyExpired(deps(), row.id);
    const [n] = await ctx.db.select().from(notifications).where(and(eq(notifications.bookingId, row.id), eq(notifications.type, 'payment_failed')));
    expect(n?.body).toContain('slot released');
  });

  it('a payment that lands just before expiry is caught, not expired', async () => {
    const c = await json<PublicBookingConfirmation>(await book('pay-a', deposit, at('16:00')), 201);
    ctx.toyyibpay.pay(billOf((await json<PaymentLink>(await pay(c.token))).paymentUrl));
    await expirePendingBookings(deps(), new Date(Date.parse(c.expiresAt!) + 1000));
    expect(await bookingRow(c.token)).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
  });

  it('paid after expiry: slot taken back if free, otherwise kept cancelled for a refund', async () => {
    const free = await json<PublicBookingConfirmation>(await book('pay-a', deposit, at('17:00')), 201);
    const freeBill = billOf((await json<PaymentLink>(await pay(free.token))).paymentUrl);
    const taken = await json<PublicBookingConfirmation>(await book('pay-a', deposit, at('18:00')), 201);
    const takenBill = billOf((await json<PaymentLink>(await pay(taken.token))).paymentUrl);
    await expirePendingBookings(deps(), new Date(Date.parse(taken.expiresAt!) + 1000));

    // Someone else books 6 PM on the same court after it was released.
    await json(await ctx.send('POST', '/bookings', ownerA, { serviceId: deposit, resourceId: court1, startAt: at('18:00'), customer: { name: 'Other', phone: '+60127778888' } }), 201);

    ctx.toyyibpay.pay(freeBill);
    ctx.toyyibpay.pay(takenBill);
    expect((await syncBill(deps(), freeBill))?.outcome).toBe('reinstated');
    expect((await syncBill(deps(), takenBill))?.outcome).toBe('late_slot_taken');
    expect(await bookingRow(free.token)).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', cancelReason: null });
    expect(await bookingRow(taken.token)).toMatchObject({ status: 'cancelled', paymentStatus: 'paid' });
  });
});

describe('H7 · resend pay link, record payment', () => {
  it('owner resends the pay link (logged on the timeline); staff without payment permission cannot', async () => {
    const c = await json<PublicBookingConfirmation>(await book('pay-a', deposit, at('09:00', 4)), 201);
    const row = await bookingRow(c.token);
    const link = await json<PaymentLink>(await ctx.send('POST', `/bookings/${row.id}/pay-link`, ownerA));
    expect(link.amountSen).toBe(2000);
    expect((await eventTypes(row.id)).at(-1)).toBe('pay_link_sent');
    expect((await ctx.send('POST', `/bookings/${row.id}/pay-link`, staff)).status).toBe(403);
    expect((await ctx.send('POST', `/bookings/${row.id}/pay-link`, ownerB)).status).toBe(404);
  });

  it('cash on a pending booking confirms it; overpaying and other businesses are refused', async () => {
    const c = await json<PublicBookingConfirmation>(await book('pay-a', deposit, at('10:00', 4)), 201);
    const row = await bookingRow(c.token);
    expect(await errorOf(await ctx.send('POST', `/bookings/${row.id}/payments`, ownerA, { amountSen: 6001, method: 'cash' }))).toEqual({
      status: 400,
      code: 'payment_too_large',
    });
    expect((await ctx.send('POST', `/bookings/${row.id}/payments`, ownerB, { amountSen: 2000, method: 'cash' })).status).toBe(404);
    expect((await ctx.send('POST', `/bookings/${row.id}/payments`, staff, { amountSen: 2000, method: 'cash' })).status).toBe(403);

    const paid = await json<Booking>(
      await ctx.send('POST', `/bookings/${row.id}/payments`, ownerA, { amountSen: 2000, method: 'duitnow_qr', reference: 'DN123' }),
      201,
    );
    expect(paid).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', paidSen: 2000, expiresAt: null });
    const [p] = await ctx.db.select().from(payments).where(and(eq(payments.bookingId, row.id), eq(payments.provider, 'manual')));
    expect(p).toMatchObject({ purpose: 'deposit', method: 'duitnow_qr', transactionRef: 'DN123', status: 'paid' });

    // Balance at the venue.
    const full = await json<Booking>(await ctx.send('POST', `/bookings/${row.id}/payments`, ownerA, { amountSen: 4000, method: 'cash' }), 201);
    expect(full.paidSen).toBe(6000);
    expect(await errorOf(await ctx.send('POST', `/bookings/${row.id}/payments`, ownerA, { amountSen: 100, method: 'cash' }))).toEqual({
      status: 409,
      code: 'nothing_to_pay',
    });
  });

  it('staff with "can take payments" record payments on their own bookings only', async () => {
    const [u] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, 'staff@example.com'));
    const members = await json<{ members: { memberId: number; userId: number }[] }>(await ctx.get('/staff', ownerA));
    const memberId = members.members.find((m) => m.userId === u!.id)!.memberId;
    await json(await ctx.send('PATCH', `/staff/${memberId}`, ownerA, { canTakePayments: true }));

    const own = await json<Booking>(await ctx.send('POST', '/bookings', ownerA, { serviceId: deposit, resourceId: court1, startAt: at('11:00', 4), customer: { name: 'Mine', phone: '+60121110001' } }), 201);
    const other = await json<Booking>(await ctx.send('POST', '/bookings', ownerA, { serviceId: deposit, resourceId: court2, startAt: at('11:00', 4), customer: { name: 'Theirs', phone: '+60121110002' } }), 201);
    expect((await ctx.send('POST', `/bookings/${own.id}/payments`, staff, { amountSen: 6000, method: 'card' })).status).toBe(201);
    expect((await ctx.send('POST', `/bookings/${other.id}/payments`, staff, { amountSen: 6000, method: 'card' })).status).toBe(404);
  });
});

describe('D5 · remind tomorrow’s customers', () => {
  it('lists tomorrow’s bookings and marks a reminder sent', async () => {
    const b = await json<Booking>(await ctx.send('POST', '/bookings', ownerA, { serviceId: deposit, resourceId: court2, startAt: at('09:00', 1), customer: { name: 'Lee Wei', phone: '+60121119999' } }), 201);
    const list = await json<{ date: string; bookings: Booking[] }>(await ctx.get('/bookings/reminders', ownerA));
    expect(list.date).toBe(day(1));
    const item = list.bookings.find((x) => x.id === b.id);
    expect(item?.reminderSentAt).toBeNull();

    const sent = await json<Booking>(await ctx.send('POST', `/bookings/${b.id}/reminder`, ownerA));
    expect(sent.reminderSentAt).not.toBeNull();
    expect((await eventTypes(b.id)).at(-1)).toBe('reminder_sent');
    expect((await ctx.send('POST', `/bookings/${b.id}/reminder`, ownerB)).status).toBe(404);
  });
});

describe('daily jobs', () => {
  it('staff day summary goes to people with bookings that day', async () => {
    await ctx.send('PUT', '/me/push-token', ownerA, { token: 'ExponentPushToken[owner]', platform: 'android' });
    await ctx.send('PUT', '/me/push-token', staff, { token: 'ExponentPushToken[staff]', platform: 'android' });
    await ctx.send('PUT', '/me/push-token', ownerB, { token: 'ExponentPushToken[ownerB]', platform: 'android' });
    ctx.pushes.length = 0;
    const sender = { send: async (m: { to: string }[]) => { ctx.pushes.push(...(m as never[])); return m.map(() => ({ status: 'ok' as const, id: 'x' })); } };
    await staffDaySummary(ctx.db, sender, new Date(at('06:00', 4)));
    const to = ctx.pushes.map((p) => p.to).sort();
    expect(to).toContain('ExponentPushToken[owner]');
    expect(to).toContain('ExponentPushToken[staff]');
    expect(to).not.toContain('ExponentPushToken[ownerB]');
    expect(ctx.pushes.find((p) => p.to === 'ExponentPushToken[staff]')!.title).toMatch(/^Today: \d+ booking/);
  });

  it('trial reminders are sent once: ending soon, then ended', async () => {
    const [sub] = await ctx.db.select().from(subscriptions).where(eq(subscriptions.businessId, businessA));
    const sender = { send: async (m: unknown[]) => m.map(() => ({ status: 'ok' as const, id: 'x' })) };
    const soon = new Date(sub!.trialEndsAt.getTime() - 36 * 3600_000);
    expect(await trialReminders(ctx.db, sender, soon)).toBeGreaterThan(0);
    await trialReminders(ctx.db, sender, soon);
    const ending = await ctx.db.select().from(notifications).where(and(eq(notifications.businessId, businessA), eq(notifications.type, 'trial_ending')));
    expect(ending).toHaveLength(1);
    expect(ending[0]!.title).toBe('Free trial ends in 2 days');

    await trialReminders(ctx.db, sender, new Date(sub!.trialEndsAt.getTime() + 3600_000));
    const ended = await ctx.db.select().from(notifications).where(and(eq(notifications.businessId, businessA), eq(notifications.type, 'trial_ended')));
    expect(ended).toHaveLength(1);
  });
});
