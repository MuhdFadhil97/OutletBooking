import { Hono } from 'hono';
import { reportQuery } from '@outletbooking/shared';
import { requireSession } from '../middleware/session';
import { requireRole, resolveTenant } from '../middleware/tenant';
import { getReport } from '../services/reports';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/** O8 reports (FR-13): owner only. */
export const reportRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant, requireRole('owner'))
  .get('/', validate('query', reportQuery), async (c) => c.json(await getReport(c.var.db, c.var.tenant.businessId, c.req.valid('query'))));
