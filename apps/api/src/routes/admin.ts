import { Hono } from 'hono';
import {
  adminBusinessQuery,
  adminNoteSchema,
  auditLogQuery,
  bookingPageSchema,
  changeOwnerSchema,
  changePlanSchema,
  extendTrialSchema,
  freeMonthsSchema,
  idParam,
  ownerLinkSchema,
  suspendSchema,
  unsuspendSchema,
} from '@outletbooking/shared';
import { requirePlatformAdmin } from '../middleware/platform-admin';
import { requireSession } from '../middleware/session';
import {
  addAdminNote,
  changeOwner,
  changePlan,
  extendTrial,
  giveFreeMonths,
  sendOwnerPasswordReset,
  getAdminBusiness,
  listAdminBusinesses,
  listAuditLog,
  resendOwnerConfirmEmail,
  setBookingPage,
  suspendBusiness,
  unsuspendBusiness,
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
  .post('/businesses/:id/free-months', validate('param', idParam), validate('json', freeMonthsSchema), async (c) =>
    c.json(await giveFreeMonths(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .post('/businesses/:id/change-plan', validate('param', idParam), validate('json', changePlanSchema), async (c) =>
    c.json(await changePlan(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .post('/businesses/:id/password-reset', validate('param', idParam), validate('json', ownerLinkSchema), async (c) =>
    c.json(
      await sendOwnerPasswordReset(
        c.var.db,
        c.var.auth,
        c.var.userId,
        c.req.valid('param').id,
        c.req.valid('json').reason,
        c.req.raw.headers,
      ),
    ),
  )
  .post('/businesses/:id/confirm-email', validate('param', idParam), validate('json', ownerLinkSchema), async (c) =>
    c.json(
      await resendOwnerConfirmEmail(c.var.db, c.var.mailer, c.var.env, c.var.userId, c.req.valid('param').id, c.req.valid('json').reason),
    ),
  )
  .post('/businesses/:id/booking-page', validate('param', idParam), validate('json', bookingPageSchema), async (c) =>
    c.json(await setBookingPage(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .post('/businesses/:id/suspend', validate('param', idParam), validate('json', suspendSchema), async (c) =>
    c.json(await suspendBusiness(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .post('/businesses/:id/unsuspend', validate('param', idParam), validate('json', unsuspendSchema), async (c) =>
    c.json(await unsuspendBusiness(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json').reason)),
  )
  .post('/businesses/:id/change-owner', validate('param', idParam), validate('json', changeOwnerSchema), async (c) =>
    c.json(await changeOwner(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .post('/businesses/:id/notes', validate('param', idParam), validate('json', adminNoteSchema), async (c) =>
    c.json(await addAdminNote(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json').reason), 201),
  )
  .get('/audit-log', validate('query', auditLogQuery), async (c) => c.json(await listAuditLog(c.var.db, c.req.valid('query'))));
