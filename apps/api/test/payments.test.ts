import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { and, eq } from 'drizzle-orm';
import { bookingEvents, bookings, businesses, businessMembers, paymentAccounts, payments } from '@outletbooking/db';
import type {
  Booking,
  BookingPayments,
  NotificationList,
  PaymentAccountView,
  PaymentTest,
  PublicAvailability,
  PublicBookingConfirmation,
  Resource,
  Service,
  SetupChecklist,
} from '@outletbooking/shared';
import { EXPIRED_REASON } from '../src/services/payments';
import { createTestContext, signupInput } from './helpers';

/** Phase 5 · H1 connect, online booking payments (callback re-check), H7 manual payments. */
const ctx = createTestContext();
const fake = ctx.toyyibpay;
let owner = '';
let ownerB = '';
let staff = '';
let court1 = 0;
let court2 = 0;
let paidSvc = 0;
let n = 0;

const TZ = 'Asia/Kuala_Lumpur';
const day = (d: number) => formatInTimeZone(addDays(new Date(), d), TZ, 'yyyy-MM-dd');
const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const callback = (billcode: string, extra: Record<string, string> = {}) =>
  ctx.app.request('/payments/toyyibpay/callback', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ billcode, status: '1', refno: 'TP123', order_id: 'x', amount: '30.00', ...extra }).toString(),
  });
const view = async (token: string) => json<PublicBookingConfirmation>(await ctx.get(`/public/bookings/${token}`));
const pay = async (token: string) => json<{ url: string }>(await ctx.post(`/public/bookings/${token}/pay`, {}));
const billOf = (url: string) => url.split('/').at(-1)!;

async function webBooking(resourceId = court1, d = 2) {
  const slots = await json<PublicAvailability>(
    await ctx.get(`/public/pay-a/slots?serviceId=${paidSvc}&date=${day(d)}&resourceId=${resourceId}`),
  );
  const slot = slots.slots[n++ % slots.slots.length]!;
  return json<PublicBookingConfirmation>(
    await ctx.post('/public/pay-a/bookings', {
      serviceId: paidSvc,
      resourceId,
      startAt: slot.startAt,
      customer: { name: 'Team Mega', phone: `+6011303${String(n).padStart(4, '0')}`, email: 'mega@example.com' },
    }),
    201,
  );
}
const bookingId = async (token: string) =>
  (await ctx.db.select({ id: bookings.id }).from(bookings).where(eq(bookings.publicToken, token)))[0]!.id;

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'pay-a', businessName: 'Smash Arena PJ' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'pay-b' }))).status).toBe(201);
  owner = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');
  court1 = (await json<Resource>(await ctx.send('POST', '/resources', owner, { name: 'Court 1', resourceType: 'court' }), 201)).id;
  court2 = (await json<Resource>(await ctx.send('POST', '/resources', owner, { name: 'Court 2', resourceType: 'court' }), 201)).id;
  for (const id of [court1, court2]) {
    await json(
      await ctx.send('PUT', `/resources/${id}/working-hours`, owner, {
        hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '08:00', endTime: '22:00' })),
      }),
    );
  }
  paidSvc = (
    await json<Service>(
      await ctx.send('POST', '/services', owner, {
        name: 'Badminton',
        durationMin: 60,
        priceSen: 3000,
        prepayFull: true,
        resourceIds: [court1, court2],
      }),
      201,
    )
  ).id;
  // A staff member who may not take payments.
  const staffId = await ctx.createUser('Aina', 'aina@example.com');
  const [biz] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'pay-a'));
  await ctx.db.insert(businessMembers).values({ businessId: biz!.id, userId: staffId, role: 'staff', canViewAll: true, canTakePayments: false });
  staff = await ctx.login('aina@example.com', 'password123');
});
afterAll(() => ctx.close());

describe('H1 · connect ToyyibPay', () => {
  it('owner only', async () => {
    expect((await ctx.get('/payment-account', staff)).status).toBe(403);
    expect((await ctx.send('PUT', '/payment-account', staff, { secretKey: 'abcdefghij-1234' })).status).toBe(403);
    expect(await json<PaymentAccountView>(await ctx.get('/payment-account', owner))).toMatchObject({ status: 'not_connected' });
  });

  it('a key ToyyibPay rejects is not stored', async () => {
    const res = await ctx.send('PUT', '/payment-account', owner, { secretKey: 'bad-key-0000' });
    expect(res.status).toBe(400);
    expect(await code(res)).toBe('toyyibpay_key_rejected');
    expect(await ctx.db.select().from(paymentAccounts)).toHaveLength(0);
    expect((await ctx.send('PUT', '/payment-account', owner, { secretKey: 'short' })).status).toBe(400);
  });

  it('connects: category created, key stored encrypted, only last 4 shown', async () => {
    const secretKey = 'w5x7srq7-rx5r-3t8b-4sl2-h0kh0xwnxwk4';
    const res = await ctx.send('PUT', '/payment-account', owner, { secretKey });
    const text = await res.clone().text();
    const acc = await json<PaymentAccountView>(res);
    expect(acc).toMatchObject({ status: 'connected', secretKeyLast4: 'xwk4', categoryCode: expect.any(String), testedAt: null });
    expect(text).not.toContain(secretKey);
    expect(fake.categories.at(-1)).toEqual({ secretKey, name: 'OutletBooking Smash Arena PJ' });
    const [row] = await ctx.db.select().from(paymentAccounts);
    expect(row!.secretKeyEncrypted).toMatch(/^v1:/);
    expect(row!.secretKeyEncrypted).not.toContain(secretKey);
    // D8 checklist ticks.
    const list = await json<SetupChecklist>(await ctx.get('/businesses/current/checklist', owner));
    expect(list.steps.find((s) => s.key === 'payments')!.done).toBe(true);
  });

  it('RM 1.00 test: passes only once ToyyibPay says paid (check or callback)', async () => {
    const test = await json<PaymentTest>(await ctx.send('POST', '/payment-account/test', owner));
    const bill = fake.bills.get(test.billCode)!;
    expect(bill).toMatchObject({ amountSen: 100, secretKey: 'w5x7srq7-rx5r-3t8b-4sl2-h0kh0xwnxwk4', externalRef: expect.stringMatching(/^TEST-/) });
    expect(test.url).toBe(`https://dev.toyyibpay.test/${test.billCode}`);
    expect((await json<PaymentAccountView>(await ctx.send('POST', '/payment-account/test/check', owner))).testedAt).toBeNull();
    fake.pay(test.billCode);
    expect((await callback(test.billCode)).status).toBe(200);
    expect((await json<PaymentAccountView>(await ctx.get('/payment-account', owner))).testedAt).not.toBeNull();
  });
});

describe('online payment for a web booking', () => {
  let token = '';

  it('pending booking → pay link with the business’s own key, deposit/full amount, return + callback URLs', async () => {
    const c = await webBooking(court1, 2);
    token = c.token;
    expect(c).toMatchObject({ status: 'pending', paymentStatus: 'unpaid', payment: { required: true, amountSen: 3000, status: 'pending', onlineAvailable: true } });
    const { url } = await pay(token);
    const bill = fake.bills.get(billOf(url))!;
    expect(bill).toMatchObject({
      secretKey: 'w5x7srq7-rx5r-3t8b-4sl2-h0kh0xwnxwk4',
      amountSen: 3000,
      returnUrl: `http://localhost:8081/book/pay-a/b/${token}`,
      callbackUrl: 'https://api.test/payments/toyyibpay/callback',
      payerName: 'Team Mega',
    });
    // Tapping Pay again reuses the open bill.
    expect((await pay(token)).url).toBe(url);
  });

  it('a callback alone never marks paid — ToyyibPay is asked first', async () => {
    const bill = fake.lastBill();
    expect((await callback(bill, { status: '1' })).status).toBe(200);
    expect(await view(token)).toMatchObject({ status: 'pending', paymentStatus: 'unpaid' });
    // Unknown / junk bill codes are answered OK and ignored.
    expect((await callback('nosuchbill1')).status).toBe(200);
    expect((await callback('../etc')).status).toBe(200);
  });

  it('paid at ToyyibPay → callback confirms, once', async () => {
    const bill = fake.lastBill();
    fake.pay(bill);
    await callback(bill);
    await callback(bill); // ToyyibPay may call twice
    const v = await view(token);
    expect(v).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', expiresAt: null, payment: { status: 'paid', required: false } });
    const id = await bookingId(token);
    const events = await ctx.db.select({ type: bookingEvents.eventType }).from(bookingEvents).where(eq(bookingEvents.bookingId, id));
    expect(events.filter((e) => e.type === 'paid')).toHaveLength(1);
    expect(events.map((e) => e.type)).toContain('confirmed');
    const [p] = await ctx.db.select().from(payments).where(eq(payments.billCode, bill));
    expect(p).toMatchObject({ status: 'paid', purpose: 'full_payment', provider: 'toyyibpay', method: 'fpx', transactionRef: `TP${bill}` });
    const notes = await json<NotificationList>(await ctx.get('/notifications', owner));
    expect(notes.items[0]).toMatchObject({ type: 'booking_paid', title: 'New booking · paid RM 30', bookingId: id });
    // Nothing left to pay.
    expect(await code(await ctx.post(`/public/bookings/${token}/pay`, {}))).toBe('nothing_to_pay');
  });

  it('less than the amount due is not "paid"', async () => {
    const c = await webBooking(court1, 3);
    const { url } = await pay(c.token);
    fake.pay(billOf(url), 100);
    await callback(billOf(url));
    expect(await view(c.token)).toMatchObject({ status: 'pending', paymentStatus: 'unpaid' });
  });

  it('bank failure → F4 "failed", owner told, retry makes a new bill; refresh re-checks', async () => {
    const c = await webBooking(court2, 3);
    const first = billOf((await pay(c.token)).url);
    fake.fail(first);
    const failed = await json<PublicBookingConfirmation>(await ctx.post(`/public/bookings/${c.token}/refresh`, {}));
    expect(failed).toMatchObject({ status: 'pending', payment: { status: 'failed', reference: first } });
    const notes = await json<NotificationList>(await ctx.get('/notifications', owner));
    expect(notes.items[0]).toMatchObject({ type: 'payment_failed', title: 'Payment not completed' });

    const second = billOf((await pay(c.token)).url);
    expect(second).not.toBe(first);
    fake.pay(second);
    // Customer came back from the bank before the callback arrived.
    expect(await json<PublicBookingConfirmation>(await ctx.post(`/public/bookings/${c.token}/refresh`, {}))).toMatchObject({
      status: 'confirmed',
      payment: { status: 'paid' },
    });
  });

  it('paid after the hold ran out: revived when the slot is free, else the owner is told to refund', async () => {
    const release = async (token: string) => {
      const id = await bookingId(token);
      await ctx.db
        .update(bookings)
        .set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: EXPIRED_REASON, expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(bookings.id, id));
      await ctx.db.update(payments).set({ status: 'expired' }).where(and(eq(payments.bookingId, id), eq(payments.status, 'pending')));
      return id;
    };

    const free = await webBooking(court1, 5);
    const freeBill = billOf((await pay(free.token)).url);
    await release(free.token);
    fake.pay(freeBill);
    await callback(freeBill);
    expect(await view(free.token)).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });

    const taken = await webBooking(court2, 5);
    const takenBill = billOf((await pay(taken.token)).url);
    const takenId = await release(taken.token);
    const [orig] = await ctx.db.select().from(bookings).where(eq(bookings.id, takenId));
    // Someone else books the released slot.
    await json<Booking>(
      await ctx.send('POST', '/bookings', owner, {
        serviceId: paidSvc,
        resourceId: court2,
        startAt: orig!.startAt.toISOString(),
        customer: { name: 'Walk-in', phone: '+60120000009' },
      }),
      201,
    );
    fake.pay(takenBill);
    await callback(takenBill);
    expect(await view(taken.token)).toMatchObject({ status: 'cancelled', paymentStatus: 'paid' });
    const notes = await json<NotificationList>(await ctx.get('/notifications', owner));
    expect(notes.items[0]!.title).toBe('Paid RM 30 after the slot was released — please refund');
  });

  it('auto-confirm off: paid booking waits for the owner, but is no longer released', async () => {
    await ctx.send('PATCH', '/businesses/current', owner, { autoConfirmPaid: false });
    const c = await webBooking(court1, 6);
    const bill = billOf((await pay(c.token)).url);
    fake.pay(bill);
    await callback(bill);
    expect(await view(c.token)).toMatchObject({ status: 'pending', paymentStatus: 'paid', expiresAt: null });
    await ctx.send('PATCH', '/businesses/current', owner, { autoConfirmPaid: true });
  });

  it('ToyyibPay down: pay answers 502 with a clear message, callback still 200', async () => {
    const c = await webBooking(court2, 6);
    fake.down = true;
    const res = await ctx.post(`/public/bookings/${c.token}/pay`, {});
    expect(res.status).toBe(502);
    expect(await code(res)).toBe('toyyibpay_error');
    expect((await callback(fake.lastBill())).status).toBe(200);
    fake.down = false;
  });
});

describe('H7 · unpaid booking: pay link + record payment', () => {
  let id = 0;

  beforeAll(async () => {
    id = await bookingId((await webBooking(court2, 7)).token);
  });

  it('payments list + resend pay link (logged on the timeline)', async () => {
    const { url } = await json<{ url: string }>(await ctx.send('POST', `/bookings/${id}/pay-link`, owner));
    const list = await json<BookingPayments>(await ctx.get(`/bookings/${id}/payments`, owner));
    expect(list).toMatchObject({ paidSen: 0, onlineAvailable: true, payLink: { url } });
    expect(list.items[0]).toMatchObject({ provider: 'toyyibpay', status: 'pending', amountSen: 3000 });
    const events = await ctx.db.select({ type: bookingEvents.eventType }).from(bookingEvents).where(eq(bookingEvents.bookingId, id));
    expect(events.map((e) => e.type)).toContain('pay_link_sent');
  });

  it('needs can_take_payments; amount capped; cash confirms the booking', async () => {
    const body = { amountSen: 3000, method: 'cash', reference: 'Counter' };
    expect((await ctx.send('POST', `/bookings/${id}/payments`, staff, body)).status).toBe(403);
    expect((await ctx.send('POST', `/bookings/${id}/payments`, ownerB, body)).status).toBe(404);
    const tooMuch = await ctx.send('POST', `/bookings/${id}/payments`, owner, { ...body, amountSen: 3001 });
    expect(tooMuch.status).toBe(400);
    expect(await code(tooMuch)).toBe('amount_too_large');
    expect((await ctx.send('POST', `/bookings/${id}/payments`, owner, { ...body, method: 'cheque' })).status).toBe(400);

    const b = await json<Booking>(await ctx.send('POST', `/bookings/${id}/payments`, owner, body), 201);
    expect(b).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', paidSen: 3000, expiresAt: null });
    const list = await json<BookingPayments>(await ctx.get(`/bookings/${id}/payments`, staff));
    expect(list.paidSen).toBe(3000);
    expect(list.payLink).toBeNull(); // the open online bill is retired
    expect(list.items[0]).toMatchObject({ provider: 'manual', method: 'cash', reference: 'Counter', recordedBy: 'Ali Hassan', status: 'paid' });
  });

  it("another business's booking: 404", async () => {
    expect((await ctx.get(`/bookings/${id}/payments`, ownerB)).status).toBe(404);
    expect((await ctx.send('POST', `/bookings/${id}/pay-link`, ownerB)).status).toBe(404);
  });
});

describe('disconnect', () => {
  it('forgets the key; new web bookings are confirmed and paid at the venue', async () => {
    const acc = await json<PaymentAccountView>(await ctx.send('DELETE', '/payment-account', owner));
    expect(acc).toMatchObject({ status: 'not_connected', secretKeyLast4: null });
    const [row] = await ctx.db.select().from(paymentAccounts);
    expect(row!.secretKeyEncrypted).toBeNull();
    const c = await webBooking(court1, 8);
    expect(c).toMatchObject({ status: 'confirmed', paymentStatus: 'unpaid', payment: { onlineAvailable: false, required: false } });
  });
});
