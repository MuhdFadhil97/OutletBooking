import { Hono } from 'hono';
import {
  addSupportNoteSchema,
  assignSupportCaseSchema,
  createSupportCaseSchema,
  idParam,
  setLeadStatusSchema,
  setSupportStatusSchema,
  supportCasesQuery,
  supportLeadsQuery,
} from '@outletbooking/shared';
import {
  addSupportNote,
  assignSupportCase,
  createSupportCase,
  getSupportCase,
  getSupportSummary,
  listSupportCases,
  listSupportLeads,
  setLeadStatus,
  setSupportStatus,
} from '../services/admin-support';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/**
 * I11 · Support (mounted under /admin/support, so the admin session and platform-admin checks run first).
 * Open to every admin role; every change writes admin_audit_log.
 */
export const adminSupportRoutes = new Hono<AppEnv>()
  .get('/summary', async (c) => c.json(await getSupportSummary(c.var.db)))
  .get('/cases', validate('query', supportCasesQuery), async (c) =>
    c.json(await listSupportCases(c.var.db, c.req.valid('query'))),
  )
  .post('/cases', validate('json', createSupportCaseSchema), async (c) =>
    c.json(await createSupportCase(c.var.db, c.var.userId, c.req.valid('json')), 201),
  )
  .get('/cases/:id', validate('param', idParam), async (c) =>
    c.json(await getSupportCase(c.var.db, c.req.valid('param').id)),
  )
  .post('/cases/:id/notes', validate('param', idParam), validate('json', addSupportNoteSchema), async (c) =>
    c.json(await addSupportNote(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json')), 201),
  )
  .post('/cases/:id/status', validate('param', idParam), validate('json', setSupportStatusSchema), async (c) =>
    c.json(await setSupportStatus(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json').status)),
  )
  .post('/cases/:id/assign', validate('param', idParam), validate('json', assignSupportCaseSchema), async (c) =>
    c.json(await assignSupportCase(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json').adminUserId)),
  )
  .get('/leads', validate('query', supportLeadsQuery), async (c) =>
    c.json(await listSupportLeads(c.var.db, c.req.valid('query'))),
  )
  .post('/leads/:id/status', validate('param', idParam), validate('json', setLeadStatusSchema), async (c) =>
    c.json(await setLeadStatus(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json').status)),
  );
