import { Hono } from 'hono';
import { deletionQuery, holdDeletionSchema, idParam } from '@outletbooking/shared';
import { requireSuperAdmin } from '../middleware/platform-admin';
import { getDeletionQueue, holdDeletion, releaseDeletion, sendDeletionNotice } from '../services/admin-deletion';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/**
 * I26 · Data deletion (mounted under /admin/deletion). Every admin can read the queue; sending a notice and holding or
 * releasing are super admins only, because they decide whether a business's data is deleted. Nothing here deletes data:
 * only the daily job does, when it is switched on for the server.
 */
export const adminDeletionRoutes = new Hono<AppEnv>()
  .get('/', validate('query', deletionQuery), async (c) =>
    c.json(await getDeletionQueue(c.var.db, c.req.valid('query').tab, c.var.env.DATA_DELETION_ENABLED)),
  )
  .post('/:id/notice', requireSuperAdmin, validate('param', idParam), async (c) => {
    await sendDeletionNotice(c.var, c.var.userId, c.req.valid('param').id);
    return c.body(null, 204);
  })
  .post('/:id/hold', requireSuperAdmin, validate('param', idParam), validate('json', holdDeletionSchema), async (c) => {
    await holdDeletion(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json').reason);
    return c.body(null, 204);
  })
  .post('/:id/release', requireSuperAdmin, validate('param', idParam), validate('json', holdDeletionSchema), async (c) => {
    await releaseDeletion(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json').reason);
    return c.body(null, 204);
  });
