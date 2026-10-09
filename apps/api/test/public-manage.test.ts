import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { eq, sql } from 'drizzle-orm';
import { businesses, pushTokens } from '@outletbooking/db';
import type {
  Availability,
  PriceQuote,
  PublicBookingConfirmation,
  Resource,
  Service,
  StaffInvitation,
} from '@outletbooking/shared';
import { settleBackground } from '../src/background';
import { createTestContext, signupInput } from './helpers';

/** Phase 4: confirmation page by token, customer cancel link, calendar file, quote, push notifications. */
const ctx = createTestContext();
const TZ = 'Asia/Kuala_Lumpur';
const day = (n: number) => formatInTimeZone(addDays(new Date(), n), TZ, 'yyyy-MM-dd');
const at = (hhmm: string, n = 3) => `${day(n)}T${hhmm}:00+08:00`;
const iso = (hhmm: string, n = 3) => new Date(at(hhmm, n)).toISOString();

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const errorOf = async (res: Response) => ({
  status: res.status,
  code: ((await res.json()) as { error: { code: string } }).error.code,
});

const TOKENS = {
  owner: 'ExponentPushToken[owner-a]',
  linked: 'ExponentPushToken[staff-court1]',
  other: 'ExponentPushToken[staff-court2]',
  ownerB: 'ExponentPushToken[owner-b]',
};

let ownerA = '';
let ownerB = '';
let linkedStaff = '';
let otherStaff = '';
let court1 = 0;
let court2 = 0;
let svc = 0;
let hidden = 0;

let phoneSeq = 0;
/** Each booking from a different phone, so the per-phone daily limit never kicks in here. */
const book = (startAt: string, resourceId = court1, phone = `+6012300${String(++phoneSeq).padStart(4, '0')}`) =>
  ctx.post('/public/manage-a/bookings', { serviceId: svc, resourceId, startAt, customer: { name: 'Aina', phone } });

async function staffFor(email: string, resourceId: number) {
  const inv = await json<StaffInvitation>(await ctx.send('POST', '/staff/invitations', ownerA, { email, resourceId }), 201);
  const token = inv.inviteUrl.split('/invite/')[1]!;
  await json(await ctx.post(`/invitations/${token}/accept`, { name: email, phone: '+60111222333', password: 'password123' }));
  return ctx.login(email, 'password123');
}

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'manage-a', businessName: 'Arena; A, PJ' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'manage-b' }))).status).toBe(201);
  ownerA = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');

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
      await ctx.send('POST', '/services', ownerA, { name: 'Court hire', durationMin: 60, priceSen: 3000, resourceIds: [court1, court2] }),
      201,
    )
  ).id;
  hidden = (await json<Service>(await ctx.send('POST', '/services', ownerA, { name: 'Members', durationMin: 60, isVisible: false }), 201)).id;

  linkedStaff = await staffFor('linked@example.com', court1);
  otherStaff = await staffFor('other@example.com', court2);
});
afterAll(() => ctx.close());

describe('GET /public/bookings/:token', () => {
  it('shows only this booking, without the customer name, with the cancel deadline', async () => {
    const created = await json<PublicBookingConfirmation>(await book(at('09:00')), 201);
    expect(created.customerName).toBe('Aina');
    const cutoff = new Date(new Date(iso('09:00')).getTime() - 120 * 60_000).toISOString();
    expect(created.cancellableUntil).toBe(cutoff);

    const page = await json<PublicBookingConfirmation>(await ctx.get(`/public/bookings/${created.token}`));
    expect(page).toEqual({ ...created, customerName: null });
    expect(page).not.toHaveProperty('id');
    expect(page.business).not.toHaveProperty('id');
  });

  it('404 for an unknown token, 400 for a malformed one', async () => {
    expect((await ctx.get(`/public/bookings/${'0'.repeat(32)}`)).status).toBe(404);
    expect((await ctx.get('/public/bookings/abc')).status).toBe(400);
  });

  it('serves an .ics calendar file with escaped text', async () => {
    const created = await json<PublicBookingConfirmation>(await book(at('10:00')), 201);
    const res = await ctx.get(`/public/bookings/${created.token}/calendar.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    const ics = await res.text();
    expect(ics).toContain(`DTSTART:${iso('10:00').replace(/[-:]/g, '').replace('.000', '')}`);
    expect(ics).toContain('SUMMARY:Court hire · Arena\\; A\\, PJ');
    expect(ics).toContain(`/my-booking/${created.token}`);
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });
});

describe('POST /public/bookings/:token/cancel', () => {
  it('cancels before the cut-off and frees the slot', async () => {
    const created = await json<PublicBookingConfirmation>(await book(at('11:00')), 201);
    const slotsOf = async () =>
      (await json<Availability>(await ctx.get(`/public/manage-a/slots?serviceId=${svc}&date=${day(3)}&resourceId=${court1}`))).slots.map(
        (s) => s.startAt,
      );
    expect(await slotsOf()).not.toContain(iso('11:00'));

    const cancelled = await json<PublicBookingConfirmation>(await ctx.post(`/public/bookings/${created.token}/cancel`, {}));
    expect(cancelled).toMatchObject({ status: 'cancelled', cancellableUntil: null });
    expect(await slotsOf()).toContain(iso('11:00'));

    expect(await errorOf(await ctx.post(`/public/bookings/${created.token}/cancel`, {}))).toEqual({
      status: 409,
      code: 'already_cancelled',
    });
  });

  it('refuses after the cut-off', async () => {
    const created = await json<PublicBookingConfirmation>(await book(at('12:00')), 201);
    await ctx.db.update(businesses).set({ cancelCutoffMin: 10 * 24 * 60 }).where(eq(businesses.slug, 'manage-a'));
    try {
      const page = await json<PublicBookingConfirmation>(await ctx.get(`/public/bookings/${created.token}`));
      expect(page.cancellableUntil).toBeNull();
      expect(await errorOf(await ctx.post(`/public/bookings/${created.token}/cancel`, {}))).toEqual({
        status: 409,
        code: 'cancel_closed',
      });
    } finally {
      await ctx.db.update(businesses).set({ cancelCutoffMin: 120 }).where(eq(businesses.slug, 'manage-a'));
    }
  });
});

describe('GET /public/:slug/quote', () => {
  it('prices the chosen slot', async () => {
    const q = await json<PriceQuote>(await ctx.get(`/public/manage-a/quote?serviceId=${svc}&startAt=${encodeURIComponent(at('15:00'))}`));
    expect(q).toMatchObject({ priceSen: 3000, amountDueSen: 0, paymentMode: 'none' });
  });

  it('hidden services and other businesses are not quoted', async () => {
    const start = encodeURIComponent(at('15:00'));
    expect((await ctx.get(`/public/manage-a/quote?serviceId=${hidden}&startAt=${start}`)).status).toBe(404);
    expect((await ctx.get(`/public/manage-b/quote?serviceId=${svc}&startAt=${start}`)).status).toBe(404);
    expect((await ctx.get(`/public/manage-a/quote?serviceId=${svc}&startAt=soon`)).status).toBe(400);
  });
});

describe('push notifications (FR-10.1)', () => {
  beforeEach(() => {
    ctx.pushes.length = 0;
    ctx.pushErrors.clear();
  });

  it('devices register a token; login is required and the token is validated', async () => {
    expect((await ctx.send('PUT', '/me/push-token', ownerA, { token: TOKENS.owner, platform: 'android' })).status).toBe(204);
    expect((await ctx.send('PUT', '/me/push-token', linkedStaff, { token: TOKENS.linked, platform: 'ios' })).status).toBe(204);
    expect((await ctx.send('PUT', '/me/push-token', otherStaff, { token: TOKENS.other, platform: 'android' })).status).toBe(204);
    expect((await ctx.send('PUT', '/me/push-token', ownerB, { token: TOKENS.ownerB, platform: 'android' })).status).toBe(204);
    // Registering again is fine (idempotent).
    expect((await ctx.send('PUT', '/me/push-token', ownerA, { token: TOKENS.owner, platform: 'android' })).status).toBe(204);

    expect((await ctx.send('PUT', '/me/push-token', ownerA, { token: 'not-a-token', platform: 'android' })).status).toBe(400);
    expect((await ctx.send('PUT', '/me/push-token', ownerA, { token: TOKENS.owner, platform: 'tv' })).status).toBe(400);
    expect((await ctx.send('PUT', '/me/push-token', '', { token: TOKENS.owner, platform: 'android' })).status).toBe(401);
    expect(await ctx.db.select({ t: pushTokens.token }).from(pushTokens)).toHaveLength(4);
  });

  it('a web booking notifies the owner and the staff linked to that resource only', async () => {
    await json(await book(at('16:00')), 201);
    await settleBackground();
    expect(ctx.pushes.map((p) => p.to).sort()).toEqual([TOKENS.linked, TOKENS.owner].sort());
    expect(ctx.pushes[0]).toMatchObject({
      title: 'New booking',
      body: expect.stringContaining('Aina · Court hire'),
      data: { type: 'booking_new', bookingId: expect.any(Number) },
    });
    expect(ctx.pushes[0]!.body).toContain('Court 1');
  });

  it('a booking on another resource skips the unlinked staff', async () => {
    await json(await book(at('16:00'), court2), 201);
    await settleBackground();
    expect(ctx.pushes.map((p) => p.to).sort()).toEqual([TOKENS.other, TOKENS.owner].sort());
  });

  it('a customer cancellation notifies too', async () => {
    const created = await json<PublicBookingConfirmation>(await book(at('17:00')), 201);
    await settleBackground();
    ctx.pushes.length = 0;
    await json(await ctx.post(`/public/bookings/${created.token}/cancel`, {}));
    await settleBackground();
    expect(ctx.pushes.map((p) => p.title)).toEqual(['Cancelled by customer', 'Cancelled by customer']);
  });

  it('deactivated staff stop receiving notifications', async () => {
    await ctx.db.execute(
      sql`UPDATE business_members SET is_active = false WHERE user_id = (SELECT id FROM users WHERE email = 'linked@example.com')`,
    );
    await json(await book(at('18:00')), 201);
    await settleBackground();
    expect(ctx.pushes.map((p) => p.to)).toEqual([TOKENS.owner]);
  });

  it('drops tokens Expo reports as DeviceNotRegistered', async () => {
    ctx.pushErrors.set(TOKENS.owner, 'DeviceNotRegistered');
    await json(await book(at('19:00')), 201);
    await settleBackground();
    expect(await ctx.db.select().from(pushTokens).where(eq(pushTokens.token, TOKENS.owner))).toEqual([]);
  });

  it('logout removes only the caller’s own token', async () => {
    expect((await ctx.send('DELETE', '/me/push-token', ownerA, { token: TOKENS.other })).status).toBe(204);
    expect(await ctx.db.select().from(pushTokens).where(eq(pushTokens.token, TOKENS.other))).toHaveLength(1);
    expect((await ctx.send('DELETE', '/me/push-token', otherStaff, { token: TOKENS.other })).status).toBe(204);
    expect(await ctx.db.select().from(pushTokens).where(eq(pushTokens.token, TOKENS.other))).toEqual([]);
  });
});
