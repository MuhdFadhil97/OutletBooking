import { Hono } from 'hono';
import { acceptAdminInviteSchema, adminInviteTokenParam } from '@outletbooking/shared';
import { rateLimit } from '../middleware/rate-limit';
import { acceptAdminInvite, getAdminInvite } from '../services/admin-users';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/**
 * Public (no session): the I10 invite link a new admin opens on the website (/admin/invite/<token>).
 * The token is the secret; responses only describe that one invite.
 */
export const adminInviteRoutes = new Hono<AppEnv>()
  .use(rateLimit({ prefix: 'admin-invite', windowMs: 15 * 60_000, max: 30 }))
  .get('/:token', validate('param', adminInviteTokenParam), async (c) =>
    c.json(await getAdminInvite(c.var.db, c.req.valid('param').token)),
  )
  .post('/:token/accept', validate('param', adminInviteTokenParam), validate('json', acceptAdminInviteSchema), async (c) =>
    c.json(await acceptAdminInvite(c.var.db, c.req.valid('param').token, c.req.valid('json'))),
  );
