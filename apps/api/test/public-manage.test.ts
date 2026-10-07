import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { eq } from 'drizzle-orm';
import { bookings, businesses } from '@outletbooking/db';
import type { BookingEvent, PublicAvailability, PublicBookingConfirmation, PublicBusiness, Resource, Service } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

/** Phase 4 public API additions: page info, priced slots, view / cancel by token (F5). */
const ctx = createTestContext();
let owner = '';
let court = 0;
let service = 0;
let peakService = 0;
let n = 0;

const TZ = 'Asia/Kuala_Lumpur';
const day = (d: number) => formatInTimeZone(addDays(new Date(), d), TZ, 'yyyy-MM-dd');
const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

/** Books the first free slot `d` days ahead as a web customer. */
async function book(d: number, customer = { name: 'Ahmad Danial', phone: '+60123456789' }, serviceId = service) {
  const slots = await json<PublicAvailability>(await ctx.get(`/public/mg-a/slots?serviceId=${serviceId}&date=${day(d)}`));
  const slot = slots.slots[n++ % slots.slots.length]!;
  return json<PublicBookingConfirmation>(
    await ctx.post('/public/mg-a/bookings', { serviceId, startAt: slot.startAt, customer, customFields: { players: 4 } }),
    201,
  );
}

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'mg-a', template: 'sports' }))).status).toBe(201);
  owner = await ctx.login('a@example.com', 'password123');
  court = (await json<Resource>(await ctx.send('POST', '/resources', owner, { name: 'Court 1', resourceType: 'court' }), 201)).id;
  await json(
    await ctx.send('PUT', `/resources/${court}/working-hours`, owner, {
      hours: [
        ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '08:00', endTime: '24:00' })),
        ...[0, 6].map((weekday) => ({ weekday, startTime: '07:00', endTime: '22:00' })),
      ],
    }),
  );
  service = (await json<Service>(await ctx.send('POST', '/services', owner, { name: 'Court hire', durationMin: 60, priceSen: 2000, resourceIds: [court] }), 201)).id;
  peakService = (
    await json<Service>(
      await ctx.send('POST', '/services', owner, {
        name: 'Peak court',
        durationMin: 60,
        priceSen: 2000,
        priceRules: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ name: 'Evening', weekday, startTime: '18:00', endTime: '24:00', priceSen: 3000 })),
        resourceIds: [court],
      }),
      201,
    )
  ).id;
});
afterAll(() => ctx.close());

describe('GET /public/:slug — page info', () => {
  it('template, cancel policy, hold time, opening hours, safe settings', async () => {
    await ctx.send('PATCH', '/businesses/current', owner, { settings: { secretNote: 'internal', customersPickResource: false } });
    const biz = await json<PublicBusiness>(await ctx.get('/public/mg-a'));
    expect(biz).toMatchObject({
      template: 'sports',
      pendingExpiryMin: 15,
      cancelPolicy: { customersCanCancel: true, cancelCutoffMin: 120, lateCancelKeepsDeposit: true },
      settings: { customersPickResource: false },
    });
    expect(biz.settings).not.toHaveProperty('secretNote');
    expect(biz.hours).toContainEqual({ weekday: 1, startTime: '08:00', endTime: '24:00' });
    expect(biz.hours).toContainEqual({ weekday: 0, startTime: '07:00', endTime: '22:00' });
  });
});

describe('GET /public/:slug/slots — priced', () => {
  it('each slot carries its price, peak times included', async () => {
    const a = await json<PublicAvailability>(await ctx.get(`/public/mg-a/slots?serviceId=${peakService}&date=${day(3)}`));
    const at = (hh: string) => a.slots.find((s) => formatInTimeZone(new Date(s.startAt), TZ, 'HH:mm') === hh);
    expect(at('10:00')?.priceSen).toBe(2000);
    expect(at('19:00')?.priceSen).toBe(3000);
  });
});

describe('F5 · view and cancel by token', () => {
  it('view shows this booking only: ref, answers, cancel window', async () => {
    const b = await book(5);
    const view = await json<PublicBookingConfirmation>(await ctx.get(`/public/bookings/${b.token}`));
    expect(view).toMatchObject({
      token: b.token,
      ref: b.token.slice(0, 4).toUpperCase(),
      status: 'confirmed',
      customerName: 'Ahmad Danial',
      answers: [{ label: 'Number of players', value: '4' }],
      cancel: { allowed: true },
      business: { slug: 'mg-a', template: 'sports' },
    });
    expect(new Date(view.cancel.until!).getTime()).toBe(new Date(view.startAt).getTime() - 120 * 60_000);
    expect(view).not.toHaveProperty('customerPhone');
  });

  it('never shows the name stored for the phone (privacy)', async () => {
    await book(6, { name: 'Siti Aminah', phone: '+60111111111' });
    const stranger = await book(6, { name: 'Someone Else', phone: '+60111111111' });
    const view = await json<PublicBookingConfirmation>(await ctx.get(`/public/bookings/${stranger.token}`));
    expect(view.customerName).toBe('Someone Else');
  });

  it('customer cancels before the cut-off: cancelled, event without actor, cannot cancel twice', async () => {
    const b = await book(7);
    const out = await json<PublicBookingConfirmation>(await ctx.post(`/public/bookings/${b.token}/cancel`, {}));
    expect(out).toMatchObject({ status: 'cancelled', cancel: { allowed: false } });
    const [row] = await ctx.db.select({ id: bookings.id, reason: bookings.cancelReason }).from(bookings).where(eq(bookings.publicToken, b.token));
    expect(row!.reason).toBe('Cancelled by customer');
    const events = await json<BookingEvent[]>(await ctx.get(`/bookings/${row!.id}/events`, owner));
    expect(events.at(-1)).toMatchObject({ type: 'cancelled', actor: null, details: { by: 'customer' } });
    const again = await ctx.post(`/public/bookings/${b.token}/cancel`, {});
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe('cannot_cancel');
  });

  it('after the cut-off, or when the business turned online cancelling off, it is refused', async () => {
    const b = await book(8);
    await ctx.db.update(bookings).set({ startAt: new Date(Date.now() + 30 * 60_000), endAt: new Date(Date.now() + 90 * 60_000), blockedStartAt: new Date(Date.now() + 30 * 60_000), blockedEndAt: new Date(Date.now() + 90 * 60_000) }).where(eq(bookings.publicToken, b.token));
    expect((await json<PublicBookingConfirmation>(await ctx.get(`/public/bookings/${b.token}`))).cancel.allowed).toBe(false);
    expect((await ctx.post(`/public/bookings/${b.token}/cancel`, {})).status).toBe(409);

    const c = await book(9);
    const [biz] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'mg-a'));
    await ctx.db.update(businesses).set({ customersCanCancel: false }).where(eq(businesses.id, biz!.id));
    const view = await json<PublicBookingConfirmation>(await ctx.get(`/public/bookings/${c.token}`));
    expect(view.cancel).toEqual({ allowed: false, until: null });
    expect((await ctx.post(`/public/bookings/${c.token}/cancel`, {})).status).toBe(409);
    await ctx.db.update(businesses).set({ customersCanCancel: true }).where(eq(businesses.id, biz!.id));
  });

  it('unknown tokens 404; malformed tokens 400', async () => {
    expect((await ctx.get(`/public/bookings/${'0'.repeat(32)}`)).status).toBe(404);
    expect((await ctx.get('/public/bookings/not-a-token')).status).toBe(400);
    expect((await ctx.post(`/public/bookings/${'0'.repeat(32)}/cancel`, {})).status).toBe(404);
  });
});
