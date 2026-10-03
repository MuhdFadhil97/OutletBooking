import { createMiddleware } from 'hono/factory';
import { unauthorized } from '../errors';
import type { AppEnv } from '../types';

/** Requires a valid Better Auth session (cookie or Expo client header). */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw unauthorized();
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId)) throw unauthorized();
  c.set('session', session);
  c.set('userId', userId);
  await next();
});
