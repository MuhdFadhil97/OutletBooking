import { Hono } from 'hono';
import {
  createPrivacyRequestSchema,
  extendPrivacySchema,
  idParam,
  privacyListQuery,
  setPrivacyChecklistSchema,
  setPrivacyNotesSchema,
  setPrivacyStatusSchema,
} from '@outletbooking/shared';
import {
  createPrivacyRequest,
  extendPrivacyRequest,
  getPrivacyRequest,
  getPrivacySummary,
  listPrivacyRequests,
  setPrivacyChecklist,
  setPrivacyNotes,
  setPrivacyStatus,
} from '../services/admin-privacy';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/**
 * I25 · Privacy requests (mounted under /admin/privacy, so the admin session and platform-admin checks run first).
 * Open to every admin role; every change writes admin_audit_log.
 */
export const adminPrivacyRoutes = new Hono<AppEnv>()
  .get('/summary', async (c) => c.json(await getPrivacySummary(c.var.db)))
  .get('/', validate('query', privacyListQuery), async (c) => c.json(await listPrivacyRequests(c.var.db, c.req.valid('query'))))
  .post('/', validate('json', createPrivacyRequestSchema), async (c) =>
    c.json(await createPrivacyRequest(c.var.db, c.var.userId, c.req.valid('json')), 201),
  )
  .get('/:id', validate('param', idParam), async (c) => c.json(await getPrivacyRequest(c.var.db, c.req.valid('param').id)))
  .post('/:id/status', validate('param', idParam), validate('json', setPrivacyStatusSchema), async (c) =>
    c.json(await setPrivacyStatus(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .post('/:id/checklist', validate('param', idParam), validate('json', setPrivacyChecklistSchema), async (c) =>
    c.json(await setPrivacyChecklist(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .post('/:id/notes', validate('param', idParam), validate('json', setPrivacyNotesSchema), async (c) =>
    c.json(await setPrivacyNotes(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json').notes)),
  )
  .post('/:id/extend', validate('param', idParam), validate('json', extendPrivacySchema), async (c) =>
    c.json(await extendPrivacyRequest(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json').reason)),
  );
