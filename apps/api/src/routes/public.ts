import { Hono } from 'hono';
import { publicSlugParam } from '@outletbooking/shared';
import { rateLimit } from '../middleware/rate-limit';
import { getPublicBusiness } from '../services/public';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/** Public booking page API (no login). Slots and booking creation arrive in Phase 4. */
export const publicRoutes = new Hono<AppEnv>()
  .use(rateLimit({ prefix: 'public', windowMs: 60_000, max: 60 }))
  .get('/:slug', validate('param', publicSlugParam), async (c) =>
    c.json(await getPublicBusiness(c.var.db, c.req.valid('param').slug)),
  );
