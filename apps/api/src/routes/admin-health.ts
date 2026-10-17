import { Hono } from 'hono';
import { closePaymentCheckSchema, idParam, retryJobParams } from '@outletbooking/shared';
import { getSystemHealth } from '../services/admin-health';
import { closePaymentCheck, recheckPayment } from '../services/payment-checks';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/**
 * I27 · System health (mounted under /admin/health). Every admin role can read it and use "Re-check now" / "Retry":
 * a Support admin needs it first when an owner says "the customer paid but the booking is not confirmed".
 * Every action writes admin_audit_log. Customer details never appear, and no key is read or shown.
 */
export const adminHealthRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await getSystemHealth({ db: c.var.db, env: c.var.env, jobs: c.var.jobs })))
  .post('/payments/:id/recheck', validate('param', idParam), async (c) =>
    c.json(await recheckPayment(c.var, c.var.userId, c.req.valid('param').id)),
  )
  .post('/payments/:id/close', validate('param', idParam), validate('json', closePaymentCheckSchema), async (c) => {
    await closePaymentCheck(c.var.db, c.var.userId, c.req.valid('param').id, c.req.valid('json').reason);
    return c.body(null, 204);
  })
  .post('/jobs/:name/:id/retry', validate('param', retryJobParams), async (c) => {
    const { name, id } = c.req.valid('param');
    await c.var.jobs.retry(name, id);
    return c.body(null, 204);
  });
