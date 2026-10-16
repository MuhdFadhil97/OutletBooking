import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { sessions } from '@outletbooking/db';
import { ADMIN_ACCOUNT_ERRORS, ADMIN_IDLE_HOURS } from '@outletbooking/shared';
import { AppError, unauthorized } from '../errors';
import type { AppEnv } from '../types';

const IDLE_MS = ADMIN_IDLE_HOURS * 60 * 60 * 1000;
/** Last-activity time is written at most this often, so a busy admin page is not one write per request. */
const TOUCH_EVERY_MS = 60_000;

/**
 * Session check for every /admin route (FR-21.8): a valid Better Auth session that was used within the last
 * ADMIN_IDLE_HOURS. An idle session is deleted and refused with `session_idle_expired`.
 *
 * `disableRefresh` matters: Better Auth otherwise stamps `updatedAt` itself once a day on any request,
 * which would make a session idle for two days look active. `updatedAt` here means "last used".
 */
export const requireAdminSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers, query: { disableRefresh: true } });
  if (!session) throw unauthorized();
  const userId = Number(session.user.id);
  const sessionId = Number(session.session.id);
  if (!Number.isInteger(userId) || !Number.isInteger(sessionId)) throw unauthorized();

  const now = Date.now();
  const lastUsed = new Date(session.session.updatedAt).getTime();
  if (now - lastUsed > IDLE_MS) {
    await c.var.db.delete(sessions).where(eq(sessions.id, sessionId));
    throw new AppError(
      401,
      ADMIN_ACCOUNT_ERRORS.idleExpired,
      `You were signed out after ${ADMIN_IDLE_HOURS} hours of no activity. Sign in again.`,
    );
  }
  if (now - lastUsed > TOUCH_EVERY_MS) {
    await c.var.db.update(sessions).set({ updatedAt: new Date(now) }).where(eq(sessions.id, sessionId));
  }

  c.set('session', session);
  c.set('userId', userId);
  await next();
});
