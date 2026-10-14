import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { ADMIN_AUTH_ERRORS, ADMIN_LOCK_MINUTES } from '@outletbooking/shared';
import { AppError, forbidden } from '../errors';
import {
  adminLockedUntil,
  clearAdminPasswordFailures,
  findAdminIdByEmail,
  isPlatformAdmin,
  recordAdminPasswordFailure,
  recordAdminSignIn,
  sessionIdsOf,
  type SignInMeta,
} from '../services/admin-sign-in';
import type { AppEnv } from '../types';

// I5 / I6: admin rules wrapped around Better Auth's own /api/auth routes (registered before auth.handler).

const emailBody = z.object({ email: z.string().trim().min(1) });
const signedIn = z.object({ user: z.object({ id: z.union([z.string(), z.number()]) }) });

function meta(c: Context<AppEnv>): SignInMeta {
  return {
    ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || null,
    userAgent: c.req.header('user-agent') ?? null,
  };
}

const lockedError = () =>
  new AppError(
    429,
    ADMIN_AUTH_ERRORS.accountLocked,
    `Too many wrong tries. This admin login is locked for ${ADMIN_LOCK_MINUTES} minutes.`,
  );

/** POST /api/auth/sign-in/email: lock an admin login after 5 wrong passwords in a row and log each one. */
export const adminPasswordGuard = createMiddleware<AppEnv>(async (c, next) => {
  const parsed = emailBody.safeParse(await c.req.raw.clone().json().catch(() => null));
  const adminId = parsed.success ? await findAdminIdByEmail(c.var.db, parsed.data.email) : null;
  if (adminId === null) return next();

  if (await adminLockedUntil(c.var.db, adminId)) throw lockedError();
  await next();
  if (c.res.status === 401) {
    if (await recordAdminPasswordFailure(c.var.db, adminId, meta(c))) throw lockedError();
  } else if (c.res.ok) {
    await clearAdminPasswordFailures(c.var.db, adminId);
  }
});

/**
 * POST /api/auth/two-factor/verify-totp | verify-backup-code: a valid code creates the admin session.
 * Log it, and after the first setup sign out sessions that were made before two-step was on.
 */
export const adminTwoFactorSignIn = (method: 'totp' | 'backup_code') =>
  createMiddleware<AppEnv>(async (c, next) => {
    const before = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    const firstSetup = !!before && !before.user.twoFactorEnabled;
    // Already signed in and only re-checking a code (e.g. I29 later): not a new sign-in.
    if (before && !firstSetup) return next();
    // Better Auth swaps the setup session for a new one; everything that existed before goes.
    const revokeSessionIds = firstSetup ? await sessionIdsOf(c.var.db, Number(before.user.id)) : [];
    await next();
    if (!c.res.ok) return;
    const body = signedIn.safeParse(await c.res.clone().json().catch(() => null));
    if (!body.success) return;
    const userId = Number(body.data.user.id);
    if (!(await isPlatformAdmin(c.var.db, userId))) return;
    await recordAdminSignIn(c.var.db, userId, { ...meta(c), method, firstSetup, revokeSessionIds });
  });

/**
 * POST /api/auth/two-factor/enable: platform admins only (owners and staff use the app, which has no
 * two-step screen). POST /api/auth/two-factor/disable: never — two-step is required for admins; a super
 * admin resets it instead (I10).
 */
export const twoFactorSetupGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.path.endsWith('/disable')) throw forbidden('Two-step sign-in cannot be turned off');
  const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (session && !(await isPlatformAdmin(c.var.db, Number(session.user.id)))) {
    throw forbidden('Two-step sign-in is for FTech admins only');
  }
  await next();
});
