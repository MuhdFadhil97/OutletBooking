import { Hono } from 'hono';
import {
  availabilityQuerySchema,
  nextAvailableQuerySchema,
  publicBookingCreateSchema,
  publicQuoteQuery,
  publicSlugParam,
  publicTokenParam,
} from '@outletbooking/shared';
import { runInBackground } from '../background';
import { rateLimit } from '../middleware/rate-limit';
import {
  bookingIcs,
  cancelPublicBooking,
  createPublicBooking,
  getPublicBooking,
  getPublicBusiness,
  publicBookingId,
  getPublicNextAvailable,
  getPublicQuote,
  getPublicSlots,
} from '../services/public';
import { createBookingPaymentLink, notifyPayment, syncBookingBills } from '../services/payments';
import { notifyBooking } from '../services/push';
import { paymentDeps } from './payments';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/**
 * Public booking page API (no login, FR-08). Exposes only what `/book/:slug` needs and
 * never other customers' data. Rate-limited per IP; booking creation more strictly.
 * Booking links use the random token (`/public/bookings/:token`); "bookings" is a reserved slug.
 */
export const publicRoutes = new Hono<AppEnv>()
  .use(rateLimit({ prefix: 'public', windowMs: 60_000, max: 60 }))
  .get('/bookings/:token', validate('param', publicTokenParam), async (c) =>
    c.json(await getPublicBooking(c.var.db, c.req.valid('param').token)),
  )
  .get('/bookings/:token/calendar.ics', validate('param', publicTokenParam), async (c) => {
    const booking = await getPublicBooking(c.var.db, c.req.valid('param').token);
    const manageUrl = `${c.var.env.APP_PUBLIC_URL.replace(/\/+$/, '')}/my-booking/${booking.token}`;
    return c.body(bookingIcs(booking, manageUrl), 200, {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'attachment; filename="booking.ics"',
    });
  })
  .post(
    '/bookings/:token/cancel',
    rateLimit({ prefix: 'public-cancel', windowMs: 10 * 60_000, max: 10 }),
    validate('param', publicTokenParam),
    async (c) => {
      const { booking, id, businessId } = await cancelPublicBooking(c.var.db, c.req.valid('param').token);
      runInBackground('push cancelled booking', () => notifyBooking(c.var.db, c.var.push, 'cancelled', businessId, id));
      return c.json(booking);
    },
  )
  // C3 / F4 · Pay the amount due on the business's own ToyyibPay (also "Try again").
  .post(
    '/bookings/:token/pay',
    rateLimit({ prefix: 'public-pay', windowMs: 10 * 60_000, max: 20 }),
    validate('param', publicTokenParam),
    async (c) => c.json(await createBookingPaymentLink(paymentDeps(c), { token: c.req.valid('param').token })),
  )
  // Back from ToyyibPay (or "I've paid"): re-check the bill with ToyyibPay, then show the booking.
  .post(
    '/bookings/:token/payment-check',
    rateLimit({ prefix: 'public-pay-check', windowMs: 60_000, max: 20 }),
    validate('param', publicTokenParam),
    async (c) => {
      const { token } = c.req.valid('param');
      const id = await publicBookingId(c.var.db, token);
      const result = await syncBookingBills(paymentDeps(c), id);
      if (result) runInBackground('notify payment', () => notifyPayment(paymentDeps(c), result));
      return c.json(await getPublicBooking(c.var.db, token));
    },
  )
  .get('/:slug', validate('param', publicSlugParam), async (c) =>
    c.json(await getPublicBusiness(c.var.db, c.req.valid('param').slug)),
  )
  .get('/:slug/slots', validate('param', publicSlugParam), validate('query', availabilityQuerySchema), async (c) =>
    c.json(await getPublicSlots(c.var.db, c.req.valid('param').slug, c.req.valid('query'))),
  )
  .get('/:slug/next-available', validate('param', publicSlugParam), validate('query', nextAvailableQuerySchema), async (c) =>
    c.json(await getPublicNextAvailable(c.var.db, c.req.valid('param').slug, c.req.valid('query'))),
  )
  .get('/:slug/quote', validate('param', publicSlugParam), validate('query', publicQuoteQuery), async (c) =>
    c.json(await getPublicQuote(c.var.db, c.req.valid('param').slug, c.req.valid('query'))),
  )
  .post(
    '/:slug/bookings',
    rateLimit({ prefix: 'public-book', windowMs: 10 * 60_000, max: 10 }),
    validate('param', publicSlugParam),
    validate('json', publicBookingCreateSchema),
    async (c) => {
      const { booking, id, businessId } = await createPublicBooking(c.var.db, c.req.valid('param').slug, c.req.valid('json'));
      runInBackground('push new booking', () => notifyBooking(c.var.db, c.var.push, 'new', businessId, id));
      return c.json(booking, 201);
    },
  );
