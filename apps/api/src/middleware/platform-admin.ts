import { createMiddleware } from 'hono/factory';
import { forbidden } from '../errors';
import { getPlatformAdmin } from '../services/admin';
import type { AppEnv } from '../types';

/** FTech platform admin only: needs a row in platform_admins (run after requireSession). */
export const requirePlatformAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const admin = await getPlatformAdmin(c.var.db, c.var.userId);
  if (!admin) throw forbidden('Platform admins only');
  c.set('admin', admin);
  await next();
});
