import { Hono } from 'hono';
import { rateLimit } from '../middleware/rate-limit';
import { getPublicPlans } from '../services/plan-catalog';
import type { AppEnv } from '../types';

/**
 * Public (no login): the plans shown on the website pricing section and in the app's E3.
 * Only price, limits and features of plans marked "shown on website" (I12), never anything per business.
 */
export const planRoutes = new Hono<AppEnv>()
  .use(rateLimit({ prefix: 'plans', windowMs: 60_000, max: 60 }))
  .get('/', async (c) => {
    c.header('cache-control', 'public, max-age=60');
    return c.json(await getPublicPlans(c.var.db));
  });
