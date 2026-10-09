import { Hono } from 'hono';
import { notificationListQuery, notificationReadSchema } from '@outletbooking/shared';
import { requireSession } from '../middleware/session';
import { resolveTenant } from '../middleware/tenant';
import { listNotifications, markNotificationsRead } from '../services/notifications';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/** D6: the signed-in user's own notifications in their business. */
export const notificationRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant)
  .get('/', validate('query', notificationListQuery), async (c) =>
    c.json(await listNotifications(c.var.db, c.var.tenant.businessId, c.var.userId, c.req.valid('query').limit)),
  )
  .post('/read', validate('json', notificationReadSchema), async (c) => {
    await markNotificationsRead(c.var.db, c.var.tenant.businessId, c.var.userId, c.req.valid('json'));
    return c.body(null, 204);
  });
