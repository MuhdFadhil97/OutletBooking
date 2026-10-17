import { Hono } from 'hono';
import { idParam } from '@outletbooking/shared';
import { requireSession } from '../middleware/session';
import { requireRole, resolveTenant } from '../middleware/tenant';
import { dismissAnnouncement, listActiveAnnouncements } from '../services/admin-announcements';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/** I28 · The banner at the top of Today (O2): owners only, for their own business. */
export const announcementRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant, requireRole('owner'))
  .get('/active', async (c) => c.json(await listActiveAnnouncements(c.var.db, c.var.tenant.businessId, c.var.userId)))
  .post('/:id/dismiss', validate('param', idParam), async (c) => {
    await dismissAnnouncement(c.var.db, c.var.tenant.businessId, c.var.userId, c.req.valid('param').id);
    return c.body(null, 204);
  });
