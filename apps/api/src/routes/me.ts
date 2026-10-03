import { Hono } from 'hono';
import { requireSession } from '../middleware/session';
import { resolveTenant } from '../middleware/tenant';
import { getMe } from '../services/me';
import type { AppEnv } from '../types';

export const meRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant)
  .get('/', async (c) => c.json(await getMe(c.var.db, c.var.userId, c.var.tenant)));
