import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  adminBusinessQuery,
  adminNoteSchema,
  adminPasswordConfirmSchema,
  adminUserActionSchema,
  changeAdminPasswordSchema,
  confirmNewPhoneSchema,
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
  planPaymentsQuery,
  recordBankTransferSchema,
  recordPlanRefundSchema,
  resendPlanReceiptSchema,
  suspendSchema,
  trialsQuery,
  unsuspendSchema,
  updatePlansSchema,
} from '@outletbooking/shared';
import { adminSupportRoutes } from './admin-support';
import { requireAdminSession } from '../middleware/admin-session';
import { requirePlatformAdmin, requireSuperAdmin } from '../middleware/platform-admin';
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
import {
  changeAdminPassword,
  confirmMovePhone,
  getAdminAccount,
  makeNewBackupCodes,
  signOutDevice,
  signOutOtherDevices,
  startMovePhone,
} from '../services/admin-account';
import { exportPlanPaymentsCsv, listPlanPayments, recordBankTransfer } from '../services/admin-payments';
import { getPlanPaymentDetail, getPlanReceiptPdfForAdmin, recordPlanRefund, resendPlanReceipt } from '../services/admin-payment-detail';
import { listTrials } from '../services/admin-trials';
import { getAdminPlanCatalog, updatePlanCatalog } from '../services/plan-catalog';
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

const refParam = z.object({ ref: z.string().trim().min(3).max(60) });

/** Where a request came from, for the sign-in log when a password is asked again. */
const requestMeta = (c: Context<AppEnv>) => ({
  ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || null,
  userAgent: c.req.header('user-agent') ?? null,
});

/** I1 / I2 / I7 / I9 / I10 / I12 / I29 platform admin (apps/web /admin). Every change needs a reason and writes admin_audit_log. */
export const adminRoutes = new Hono<AppEnv>()
  .use(requireAdminSession, requirePlatformAdmin)
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
  // I8 plan payments: every admin role may list and record a bank transfer (FR-20.2).
  .get('/payments', validate('query', planPaymentsQuery), async (c) => c.json(await listPlanPayments(c.var.db, c.req.valid('query'))))
  .get('/payments/export', validate('query', planPaymentsQuery), async (c) => {
    const csv = await exportPlanPaymentsCsv(c.var.db, c.req.valid('query'));
    const day = new Date().toISOString().slice(0, 10);
    return c.body(csv, 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="outletbooking-plan-payments-${day}.csv"`,
      'cache-control': 'no-store',
    });
  })
  .post('/payments/bank-transfer', validate('json', recordBankTransferSchema), async (c) =>
    c.json(await recordBankTransfer(c.var, c.var.userId, c.req.valid('json')), 201),
  )
  // I24 payment detail & refund. The reference is the bill code (never the integer id).
  .get('/payments/:ref', validate('param', refParam), async (c) => c.json(await getPlanPaymentDetail(c.var.db, c.req.valid('param').ref)))
  .get('/payments/:ref/receipt.pdf', validate('param', refParam), async (c) => {
    const { filename, pdf } = await getPlanReceiptPdfForAdmin(c.var.db, c.req.valid('param').ref);
    return c.body(new Uint8Array(pdf), 200, {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    });
  })
  .post('/payments/:ref/resend-receipt', validate('param', refParam), validate('json', resendPlanReceiptSchema), async (c) =>
    c.json(await resendPlanReceipt(c.var, c.var.userId, c.req.valid('param').ref, c.req.valid('json').reason)),
  )
  .post('/payments/:ref/refund', validate('param', refParam), validate('json', recordPlanRefundSchema), async (c) =>
    c.json(await recordPlanRefund(c.var, c.var.userId, c.req.valid('param').ref, c.req.valid('json')), 201),
  )
  .get('/admins', async (c) => c.json(await listAdminUsers(c.var.db)))
  // I11 support cases and website leads: every admin.
  .route('/support', adminSupportRoutes)
  // I29 my account: every admin, their own account only (the user id always comes from the session).
  .get('/account', async (c) =>
    c.json(await getAdminAccount(c.var.db, c.var.auth, c.var.admin, Number(c.var.session.session.id))),
  )
  .post('/account/password', validate('json', changeAdminPasswordSchema), async (c) =>
    c.json(
      await changeAdminPassword(c.var.db, c.var.userId, Number(c.var.session.session.id), c.req.valid('json'), requestMeta(c)),
    ),
  )
  .post('/account/backup-codes', validate('json', adminPasswordConfirmSchema), async (c) =>
    c.json(await makeNewBackupCodes(c.var.db, c.var.auth, c.var.userId, c.req.valid('json').password, requestMeta(c))),
  )
  .post('/account/two-factor/move', validate('json', adminPasswordConfirmSchema), async (c) =>
    c.json(await startMovePhone(c.var.db, c.var.auth, c.var.admin, c.req.valid('json').password, requestMeta(c))),
  )
  .post('/account/two-factor/move/confirm', validate('json', confirmNewPhoneSchema), async (c) =>
    c.json(
      await confirmMovePhone(c.var.db, c.var.auth, c.var.userId, Number(c.var.session.session.id), c.req.valid('json').code),
    ),
  )
  .post('/account/devices/sign-out-others', async (c) => {
    const signedOut = await signOutOtherDevices(c.var.db, c.var.userId, Number(c.var.session.session.id));
    return c.json({ signedOut });
  })
  .post('/account/devices/:id/sign-out', validate('param', idParam), async (c) => {
    await signOutDevice(c.var.db, c.var.userId, Number(c.var.session.session.id), c.req.valid('param').id);
    return c.json({ ok: true });
  })
  // I12 plans & prices: super admins only.
  .get('/plans', requireSuperAdmin, async (c) => c.json(await getAdminPlanCatalog(c.var.db)))
  .post('/plans', requireSuperAdmin, validate('json', updatePlansSchema), async (c) =>
    c.json(await updatePlanCatalog(c.var.db, c.var.userId, c.req.valid('json'))),
  )
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
