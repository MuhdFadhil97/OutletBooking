import { Hono } from 'hono';
import {
  adminBusinessQuery,
  adminNoteSchema,
  adminUserActionSchema,
  changeAdminRoleSchema,
  inviteAdminSchema,
  auditLogFilters,
  auditLogQuery,
  bookingPageSchema,
  changeOwnerSchema,
  changePlanSchema,
  extendTrialSchema,
  freeMonthsSchema,
  idParam,
  ownerLinkSchema,
  suspendSchema,
  trialsQuery,
  unsuspendSchema,
} from '@outletbooking/shared';
import { requirePlatformAdmin, requireSuperAdmin } from '../middleware/platform-admin';
import { requireSession } from '../middleware/session';
import {
  addAdminNote,
  changeOwner,
  changePlan,
  exportAuditLogCsv,
  extendTrial,
  giveFreeMonths,
  sendOwnerPasswordReset,
  getAdminBusiness,
  listAdminBusinesses,
  listAdminUsers,
  listAuditLog,
  resendOwnerConfirmEmail,
  setBookingPage,
  suspendBusiness,
  unsuspendBusiness,
} from '../services/admin';
import { listTrials } from '../services/admin-trials';
import {
  changeAdminRole,
  inviteAdmin,
  listAdminUserRows,
  removeAdmin,
  resendAdminInvite,
  resetAdminTwoFactor,
} from '../services/admin-users';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/** I1 / I2 / I7 / I9 / I10 platform admin (apps/web /admin). Every change needs a reason and writes admin_audit_log. */
export const adminRoutes = new Hono<AppEnv>()
  .use(requireSession, requirePlatformAdmin)
  .get('/me', (c) => c.json(c.var.admin))
  .get('/businesses', validate('query', adminBusinessQuery), async (c) =>
    c.json(await listAdminBusinesses(c.var.db, c.req.valid('query'))),
  )
  .get('/trials', validate('query', trialsQuery), async (c) => c.json(await listTrials(c.var.db, c.req.valid('query'))))
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
  .get('/admins', async (c) => c.json(await listAdminUsers(c.var.db)))
  // I10 admin users: super admins only.
  .get('/users', requireSuperAdmin, async (c) => c.json(await listAdminUserRows(c.var.db)))
  .post('/users', requireSuperAdmin, validate('json', inviteAdminSchema), async (c) =>
    c.json(await inviteAdmin(c.var.db, c.var.mailer, c.var.env, c.var.userId, c.req.valid('json')), 201),
  )
  .post('/users/:id/role', requireSuperAdmin, validate('param', idParam), validate('json', changeAdminRoleSchema), async (c) =>
    c.json(await changeAdminRole(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .post('/users/:id/reset-two-factor', requireSuperAdmin, validate('param', idParam), validate('json', adminUserActionSchema), async (c) =>
    c.json(await resetAdminTwoFactor(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json').reason)),
  )
  .post('/users/:id/remove', requireSuperAdmin, validate('param', idParam), validate('json', adminUserActionSchema), async (c) =>
    c.json(await removeAdmin(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json').reason)),
  )
  .post('/users/:id/resend-invite', requireSuperAdmin, validate('param', idParam), validate('json', adminUserActionSchema), async (c) =>
    c.json(
      await resendAdminInvite(c.var.db, c.var.mailer, c.var.env, c.var.userId, c.req.valid('param').id, c.req.valid('json').reason),
    ),
  )
  .get('/audit-log', validate('query', auditLogQuery), async (c) => c.json(await listAuditLog(c.var.db, c.req.valid('query'))))
  .get('/audit-log/export', validate('query', auditLogFilters), async (c) => {
    const csv = await exportAuditLogCsv(c.var.db, c.req.valid('query'));
    const day = new Date().toISOString().slice(0, 10);
    return c.body(csv, 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="outletbooking-audit-log-${day}.csv"`,
      'cache-control': 'no-store',
    });
  });
