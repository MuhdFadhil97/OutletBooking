import { Hono } from 'hono';
import { z } from 'zod';
import { forgotPasswordSchema, resetPasswordSchema, resetTokenSchema } from '@outletbooking/shared';
import { rateLimit } from '../middleware/rate-limit';
import { getResetTokenInfo, requestPasswordReset, resetPassword } from '../services/password';
import type { AppEnv } from '../types';
import { validate } from '../validate';

const resetLimit = rateLimit({ windowMs: 15 * 60_000, max: 20, prefix: 'pw-reset' });

/** Public (no session): E1 forgot password, E2 set new password. Rate-limited per IP. */
export const passwordRoutes = new Hono<AppEnv>()
  .post(
    '/forgot',
    rateLimit({ windowMs: 15 * 60_000, max: 5, prefix: 'pw-forgot' }),
    validate('json', forgotPasswordSchema),
    async (c) => {
      await requestPasswordReset(c.var.auth, c.req.valid('json').email, c.req.raw.headers);
      return c.json({ ok: true });
    },
  )
  .get('/reset/:token', resetLimit, validate('param', z.object({ token: resetTokenSchema })), async (c) =>
    c.json(await getResetTokenInfo(c.var.auth, c.req.valid('param').token)),
  )
  .post('/reset', resetLimit, validate('json', resetPasswordSchema), async (c) =>
    c.json(await resetPassword(c.var.auth, c.req.valid('json'))),
  );
