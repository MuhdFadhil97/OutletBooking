import { Hono } from 'hono';
import { announcementAudienceQuery, createAnnouncementSchema, idParam } from '@outletbooking/shared';
import {
  cancelAnnouncement,
  countAudience,
  createAnnouncement,
  listAnnouncements,
  sendTestAnnouncement,
} from '../services/admin-announcements';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/**
 * I28 · Announcements (mounted under /admin/announcements; the caller adds `requireSuperAdmin`, because one message can
 * reach every owner).
 */
export const adminAnnouncementRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await listAnnouncements(c.var.db)))
  .get('/audience', validate('query', announcementAudienceQuery), async (c) => {
    const q = c.req.valid('query');
    return c.json(await countAudience(c.var.db, q.audience, q.audience === 'all' ? null : (q.value ?? null)));
  })
  .post('/', validate('json', createAnnouncementSchema), async (c) =>
    c.json(await createAnnouncement(c.var, c.var.userId, c.req.valid('json')), 201),
  )
  .post('/test', validate('json', createAnnouncementSchema), async (c) =>
    c.json(await sendTestAnnouncement(c.var, c.var.userId, c.req.valid('json'))),
  )
  .post('/:id/cancel', validate('param', idParam), async (c) => {
    await cancelAnnouncement(c.var.db, c.var.userId, c.req.valid('param').id);
    return c.body(null, 204);
  });
