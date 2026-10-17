import { Hono } from 'hono';
import { rateLimit } from '../middleware/rate-limit';
import { applyResendEvent, verifySvixSignature } from '../services/resend-webhook';
import type { AppEnv } from '../types';

/**
 * Called by Resend (no login): delivery events for the emails we sent (I27 "Email delivery problems").
 * The Svix signature is the only thing that proves it is Resend; without RESEND_WEBHOOK_SECRET the route is off (503).
 */
export const webhookRoutes = new Hono<AppEnv>()
  .use(rateLimit({ prefix: 'webhooks', windowMs: 60_000, max: 300 }))
  .post('/resend', async (c) => {
    const secret = c.var.env.RESEND_WEBHOOK_SECRET;
    if (!secret) return c.json({ error: { code: 'webhook_off', message: 'Resend webhooks are not set up' } }, 503);
    const body = await c.req.text();
    const ok = verifySvixSignature(
      secret,
      { id: c.req.header('svix-id'), timestamp: c.req.header('svix-timestamp'), signature: c.req.header('svix-signature') },
      body,
    );
    if (!ok) return c.json({ error: { code: 'bad_signature', message: 'Bad signature' } }, 401);
    let event: unknown;
    try {
      event = JSON.parse(body);
    } catch {
      return c.json({ error: { code: 'bad_body', message: 'Not JSON' } }, 400);
    }
    await applyResendEvent(c.var.db, event as Parameters<typeof applyResendEvent>[1]);
    return c.json({ ok: true });
  });
