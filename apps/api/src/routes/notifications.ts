import { Hono } from 'hono';
import { idParam, pushTokenDeleteSchema, pushTokenSchema } from '@outletbooking/shared';
import { requireSession } from '../middleware/session';
import { resolveTenant } from '../middleware/tenant';
import {
  deletePushToken,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  savePushToken,
} from '../services/notifications';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/** D6 · the caller's own notifications in their current business. */
export const notificationRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant)
  .get('/', async (c) => c.json(await listNotifications(c.var.db, c.var.tenant.businessId, c.var.userId)))
  .post('/read-all', async (c) => {
    await markAllNotificationsRead(c.var.db, c.var.tenant.businessId, c.var.userId);
    return c.body(null, 204);
  })
  .post('/:id/read', validate('param', idParam), async (c) => {
    await markNotificationRead(c.var.db, c.var.tenant.businessId, c.var.userId, c.req.valid('param').id);
    return c.body(null, 204);
  });

/** This device's Expo push token: saved after login, removed on log out. */
export const pushTokenRoutes = new Hono<AppEnv>()
  .use(requireSession)
  .post('/', validate('json', pushTokenSchema), async (c) => {
    await savePushToken(c.var.db, c.var.userId, c.req.valid('json'));
    return c.body(null, 204);
  })
  .delete('/', validate('json', pushTokenDeleteSchema), async (c) => {
    await deletePushToken(c.var.db, c.var.userId, c.req.valid('json').token);
    return c.body(null, 204);
  });
