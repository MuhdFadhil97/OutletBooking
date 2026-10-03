import { Hono } from 'hono';
import { availabilityQuerySchema, publicBookingCreateSchema, publicSlugParam } from '@outletbooking/shared';
import { rateLimit } from '../middleware/rate-limit';
import { createPublicBooking, getPublicBusiness, getPublicSlots } from '../services/public';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/**
 * Public booking page API (no login, FR-08). Exposes only what `/book/:slug` needs and
 * never other customers' data. Rate-limited per IP; booking creation more strictly.
 */
export const publicRoutes = new Hono<AppEnv>()
  .use(rateLimit({ prefix: 'public', windowMs: 60_000, max: 60 }))
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
    async (c) => c.json(await createPublicBooking(c.var.db, c.req.valid('param').slug, c.req.valid('json')), 201),
  );
