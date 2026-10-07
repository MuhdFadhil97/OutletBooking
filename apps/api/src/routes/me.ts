import { Hono } from 'hono';
import { deleteAccountSchema } from '@outletbooking/shared';
import { rateLimit } from '../middleware/rate-limit';
import { requireSession } from '../middleware/session';
import { requireRole, resolveTenant } from '../middleware/tenant';
import { deleteOwnerAccount } from '../services/account-deletion';
import { getMe } from '../services/me';
import type { AppEnv } from '../types';
import { validate } from '../validate';

export const meRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant)
  .get('/', async (c) => c.json(await getMe(c.var.db, c.var.userId, c.var.tenant)))
  // H6 · Delete my account and business data. Owner only; password + business name re-typed.
  .delete(
    '/',
    requireRole('owner'),
    rateLimit({ windowMs: 15 * 60_000, max: 5, prefix: 'account-delete' }),
    validate('json', deleteAccountSchema),
    async (c) => {
      await deleteOwnerAccount(c.var.db, c.var.tenant.businessId, c.var.userId, c.req.valid('json'));
      return c.body(null, 204);
    },
  );
