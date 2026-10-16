import { createMiddleware } from 'hono/factory';
import { ADMIN_AUTH_ERRORS, ADMIN_USER_ERRORS } from '@outletbooking/shared';
import { AppError, forbidden } from '../errors';
import { getPlatformAdmin } from '../services/admin';
import type { AppEnv } from '../types';

/**
 * FTech platform admin only (run after requireSession): an active row in platform_admins and two-step
 * sign-in turned on (I6). Once it is on, Better Auth only creates a session after a valid code.
 */
export const requirePlatformAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const found = await getPlatformAdmin(c.var.db, c.var.userId);
  if (!found) throw forbidden('Platform admins only');
  if (!found.twoFactorEnabled) {
    throw new AppError(403, ADMIN_AUTH_ERRORS.twoFactorSetupRequired, 'Set up two-step sign-in first');
  }
  c.set('admin', found.admin);
  await next();
});

/** I10 / I12: super admins only (run after requirePlatformAdmin). */
export const requireSuperAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.admin.role !== 'super_admin') {
    throw new AppError(403, ADMIN_USER_ERRORS.superAdminOnly, 'Only a super admin can do this');
  }
  await next();
});
