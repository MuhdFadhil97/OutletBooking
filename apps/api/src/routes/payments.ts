import { Hono } from 'hono';
import { paymentAccountConnectSchema } from '@outletbooking/shared';
import { rateLimit } from '../middleware/rate-limit';
import { requireSession } from '../middleware/session';
import { requireRole, resolveTenant } from '../middleware/tenant';
import { Outbox } from '../services/notifications';
import {
  checkPaymentTest,
  connectPaymentAccount,
  disconnectPaymentAccount,
  getPaymentAccount,
  startPaymentTest,
  syncBill,
} from '../services/payments';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/** H1 · the business's own ToyyibPay account (owner only — staff never see payment settings). */
export const paymentAccountRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant, requireRole('owner'))
  .get('/', async (c) => c.json(await getPaymentAccount(c.var.db, c.var.tenant.businessId)))
  .put(
    '/',
    rateLimit({ prefix: 'pay-connect', windowMs: 10 * 60_000, max: 10 }),
    validate('json', paymentAccountConnectSchema),
    async (c) =>
      c.json(
        await connectPaymentAccount(c.var.db, c.var.payments, c.var.tenant.businessId, c.var.userId, c.req.valid('json').secretKey),
      ),
  )
  .delete('/', async (c) => c.json(await disconnectPaymentAccount(c.var.db, c.var.tenant.businessId)))
  .post('/test', async (c) => c.json(await startPaymentTest(c.var.db, c.var.payments, c.var.tenant.businessId)))
  .post('/test/check', async (c) => c.json(await checkPaymentTest(c.var.db, c.var.payments, c.var.tenant.businessId)));

const BILL_CODE = /^[A-Za-z0-9]{4,40}$/;

/**
 * ToyyibPay → us. The body is only a hint of which bill changed: the status is always re-checked
 * with ToyyibPay (getBillTransactions) before anything is marked paid. Always answers 200 "OK" so
 * ToyyibPay doesn't retry forever on bills we don't know.
 */
export const toyyibpayRoutes = new Hono<AppEnv>()
  .use(rateLimit({ prefix: 'toyyibpay', windowMs: 60_000, max: 120 }))
  .post('/callback', async (c) => {
    const form = await c.req.parseBody().catch(() => ({}));
    const raw = Object.fromEntries(Object.entries(form).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    const billCode = raw.billcode ?? raw.billCode ?? '';
    if (BILL_CODE.test(billCode)) {
      const outbox = new Outbox();
      try {
        await syncBill(c.var.db, c.var.payments, billCode, outbox, raw);
        void outbox.flush(c.var.db, c.var.push);
      } catch (err) {
        // ToyyibPay unreachable: the customer's refresh or the next callback will re-check.
        console.error('[toyyibpay] callback not processed:', err instanceof Error ? err.message : err);
      }
    }
    return c.text('OK');
  })
  // Return page after the H1 RM 1.00 test (bookings return to the booking page instead).
  .get('/done', (c) =>
    c.html(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>OutletBooking</title>' +
        '<body style="font-family:system-ui;padding:32px;text-align:center;color:#16211C;background:#F6F7F5">' +
        '<h2>Done</h2><p>Go back to the OutletBooking app and tap <b>Check test payment</b>.</p></body>',
    ),
  );
