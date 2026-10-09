import { Hono } from 'hono';
import { acceptInviteNewAccountSchema, acceptInviteSchema, inviteTokenParam } from '@outletbooking/shared';
import { runInBackground } from '../background';
import { rateLimit } from '../middleware/rate-limit';
import { notifyStaffJoined } from '../services/push';
import { acceptInvitation, getInvitation } from '../services/staff';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/**
 * Public (no tenant): the invite link a staff member opens. The token is the secret;
 * responses only describe that one invitation.
 */
export const invitationRoutes = new Hono<AppEnv>()
  .use(rateLimit({ prefix: 'invite', windowMs: 15 * 60_000, max: 30 }))
  .get('/:token', validate('param', inviteTokenParam), async (c) =>
    c.json(await getInvitation(c.var.db, c.req.valid('param').token)),
  )
  .post('/:token/accept', validate('param', inviteTokenParam), validate('json', acceptInviteSchema), async (c) => {
    // Optional session: existing users accept while logged in as the invited email.
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    const sessionUserId = session ? Number(session.user.id) : undefined;
    const body = acceptInviteNewAccountSchema.safeParse(c.req.valid('json'));
    const { businessId, userId, ...result } = await acceptInvitation(c.var.db, c.req.valid('param').token, {
      sessionUserId,
      newAccount: body.success ? body.data : undefined,
    });
    runInBackground('notify staff joined', () => notifyStaffJoined(c.var.db, c.var.push, businessId, userId));
    // New accounts sign in through Better Auth right after (same as owner sign-up).
    return c.json(result);
  });
