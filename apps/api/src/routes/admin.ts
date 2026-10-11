import { Hono } from 'hono';
import {
  adminBusinessQuery,
  adminNoteSchema,
  auditLogQuery,
  bookingPageSchema,
  extendTrialSchema,
  idParam,
} from '@outletbooking/shared';
import { requirePlatformAdmin } from '../middleware/platform-admin';
import { requireSession } from '../middleware/session';
import {
  addAdminNote,
  extendTrial,
  getAdminBusiness,
  listAdminBusinesses,
  listAuditLog,
  setBookingPage,
} from '../services/admin';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/** I1 / I2 platform admin (apps/web /admin). Every change needs a reason and writes admin_audit_log. */
export const adminRoutes = new Hono<AppEnv>()
  .use(requireSession, requirePlatformAdmin)
  .get('/me', (c) => c.json(c.var.admin))
  .get('/businesses', validate('query', adminBusinessQuery), async (c) =>
    c.json(await listAdminBusinesses(c.var.db, c.req.valid('query'))),
  )
  .get('/businesses/:id', validate('param', idParam), async (c) =>
    c.json(await getAdminBusiness(c.var.db, c.req.valid('param').id)),
  )
  .post('/businesses/:id/extend-trial', validate('param', idParam), validate('json', extendTrialSchema), async (c) =>
    c.json(await extendTrial(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .post('/businesses/:id/booking-page', validate('param', idParam), validate('json', bookingPageSchema), async (c) =>
    c.json(await setBookingPage(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .post('/businesses/:id/notes', validate('param', idParam), validate('json', adminNoteSchema), async (c) =>
    c.json(await addAdminNote(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json').reason), 201),
  )
  .get('/audit-log', validate('query', auditLogQuery), async (c) => c.json(await listAuditLog(c.var.db, c.req.valid('query'))));
