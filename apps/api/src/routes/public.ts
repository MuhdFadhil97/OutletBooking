import { Hono } from 'hono';
import { availabilityQuerySchema, publicBookingCreateSchema, publicSlugParam, publicTokenParam } from '@outletbooking/shared';
import { rateLimit } from '../middleware/rate-limit';
import { Outbox } from '../services/notifications';
import { bookingByToken, payLinkForBooking, syncBookingBills } from '../services/payments';
import { cancelPublicBooking, createPublicBooking, getPublicBooking, getPublicBusiness, getPublicSlots } from '../services/public';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/**
 * Public booking page API (no login, FR-08). Exposes only what `/book/:slug` needs and
 * never other customers' data. Rate-limited per IP; booking creation more strictly.
 */
export const publicRoutes = new Hono<AppEnv>()
  .use(rateLimit({ prefix: 'public', windowMs: 60_000, max: 60 }))
  // F5 · the customer's own booking, by the random token in their link ('bookings' is a reserved slug).
  .get('/bookings/:token', validate('param', publicTokenParam), async (c) =>
    c.json(await getPublicBooking(c.var.db, c.req.valid('param').token)),
  )
  .post(
    '/bookings/:token/cancel',
    rateLimit({ prefix: 'public-cancel', windowMs: 10 * 60_000, max: 10 }),
    validate('param', publicTokenParam),
    async (c) => {
      const outbox = new Outbox();
      const result = await cancelPublicBooking(c.var.db, c.req.valid('param').token, outbox);
      void outbox.flush(c.var.db, c.var.push);
      return c.json(result);
    },
  )
  // C4 / F4 · "Pay RM x": the ToyyibPay page for this booking (business's own account).
  .post(
    '/bookings/:token/pay',
    rateLimit({ prefix: 'public-pay', windowMs: 10 * 60_000, max: 20 }),
    validate('param', publicTokenParam),
    async (c) => {
      const b = await bookingByToken(c.var.db, c.req.valid('param').token);
      const { url } = await payLinkForBooking(c.var.db, c.var.payments, b.businessId, b.id);
      return c.json({ url });
    },
  )
  // Back from the bank: re-check open bills with ToyyibPay, then show the booking.
  .post(
    '/bookings/:token/refresh',
    rateLimit({ prefix: 'public-refresh', windowMs: 60_000, max: 12 }),
    validate('param', publicTokenParam),
    async (c) => {
      const { token } = c.req.valid('param');
      const b = await bookingByToken(c.var.db, token);
      const outbox = new Outbox();
      await syncBookingBills(c.var.db, c.var.payments, b.id, outbox);
      void outbox.flush(c.var.db, c.var.push);
      return c.json(await getPublicBooking(c.var.db, token));
    },
  )
  .get('/:slug', validate('param', publicSlugParam), async (c) =>
    c.json(await getPublicBusiness(c.var.db, c.req.valid('param').slug)),
  )
  .get('/:slug/slots', validate('param', publicSlugParam), validate('query', availabilityQuerySchema), async (c) =>
    c.json(await getPublicSlots(c.var.db, c.req.valid('param').slug, c.req.valid('query'))),
  )
  .post(
    '/:slug/bookings',
    rateLimit({ prefix: 'public-book', windowMs: 10 * 60_000, max: 10 }),
    validate('param', publicSlugParam),
    validate('json', publicBookingCreateSchema),
    async (c) => {
      const outbox = new Outbox();
      const result = await createPublicBooking(c.var.db, c.req.valid('param').slug, c.req.valid('json'), outbox);
      void outbox.flush(c.var.db, c.var.push);
      return c.json(result, 201);
    },
  );
