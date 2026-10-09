import { Hono, type Context } from 'hono';
import { connectToyyibPaySchema } from '@outletbooking/shared';
import { runInBackground } from '../background';
import { rateLimit } from '../middleware/rate-limit';
import { requireSession } from '../middleware/session';
import { requireRole, resolveTenant } from '../middleware/tenant';
import {
  checkTestPayment,
  connectToyyibPay,
  disconnectToyyibPay,
  getPaymentAccount,
  handleToyyibPayCallback,
  notifyPayment,
  startTestPayment,
  type PaymentDeps,
} from '../services/payments';
import type { AppEnv } from '../types';
import { validate } from '../validate';

export const paymentDeps = (c: Context<AppEnv>): PaymentDeps => ({
  db: c.var.db,
  env: c.var.env,
  toyyibpay: c.var.toyyibpay,
  push: c.var.push,
});

/** H1 · The owner connects their own ToyyibPay account. The key never comes back out. */
export const paymentRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant, requireRole('owner'))
  .get('/account', async (c) => c.json(await getPaymentAccount(c.var.db, c.var.tenant.businessId)))
  .post(
    '/account',
    rateLimit({ prefix: 'toyyibpay-connect', windowMs: 15 * 60_000, max: 10 }),
    validate('json', connectToyyibPaySchema),
    async (c) =>
      c.json(await connectToyyibPay(paymentDeps(c), c.var.tenant.businessId, c.var.userId, c.req.valid('json').secretKey)),
  )
  .delete('/account', async (c) => c.json(await disconnectToyyibPay(c.var.db, c.var.tenant.businessId)))
  .post('/account/test', async (c) => c.json(await startTestPayment(paymentDeps(c), c.var.tenant.businessId, c.var.userId)))
  .post('/account/test/check', async (c) => c.json(await checkTestPayment(paymentDeps(c), c.var.tenant.businessId)));

/**
 * Called by ToyyibPay (no login). The body is never trusted: the bill is re-checked with
 * getBillTransactions before anything is marked paid. Always answers 200 "OK" so ToyyibPay stops retrying.
 */
export const toyyibPayRoutes = new Hono<AppEnv>()
  .use(rateLimit({ prefix: 'toyyibpay-callback', windowMs: 60_000, max: 120 }))
  .post('/callback', async (c) => {
    const body = await c.req.parseBody();
    const form = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, typeof v === 'string' ? v : '']));
    try {
      const result = await handleToyyibPayCallback(paymentDeps(c), form);
      if (result) runInBackground('notify payment', () => notifyPayment(paymentDeps(c), result));
    } catch (err) {
      console.error('[toyyibpay] callback failed', err);
    }
    return c.text('OK');
  })
  // Where the owner lands after the RM 1.00 test payment (opened from the app in a browser).
  .get('/test-return', (c) => {
    const ok = c.req.query('status_id') === '1';
    return c.html(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>OutletBooking</title></head>
<body style="font-family:system-ui,sans-serif;padding:32px;max-width:420px;margin:auto;color:#16211C">
<h2>${ok ? 'Test payment done' : 'Test payment not completed'}</h2>
<p>${ok ? 'Go back to the OutletBooking app and tap “Check test payment”.' : 'Go back to the OutletBooking app and try the test again.'}</p>
</body></html>`);
  });
