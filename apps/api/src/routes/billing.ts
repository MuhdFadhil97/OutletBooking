import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { checkoutSchema, receiptDetailsSchema, webLinkSchema, webSignInLinkSchema } from '@outletbooking/shared';
import { runInBackground } from '../background';
import { rateLimit } from '../middleware/rate-limit';
import { requireSession } from '../middleware/session';
import { requireRole, resolveTenant } from '../middleware/tenant';
import {
  createCheckout,
  createWebHandoffLink,
  getBillingHistory,
  getBillingOverview,
  getBillingPayment,
  getReceiptPdf,
  requestWebSignInLink,
  saveReceiptDetails,
  sendReceiptEmail,
  type BillingDeps,
  type PlanSyncResult,
} from '../services/billing';
import type { AppEnv } from '../types';
import { validate } from '../validate';

export const billingDeps = (c: Context<AppEnv>): BillingDeps => ({
  db: c.var.db,
  env: c.var.env,
  toyyibpay: c.var.toyyibpay,
  mailer: c.var.mailer,
  auth: c.var.auth,
});

/** The receipt goes out once, by the call that made the payment paid. */
export function afterPlanPaid(deps: BillingDeps, result: PlanSyncResult | null): void {
  if (result?.justPaid) runInBackground('plan receipt email', () => sendReceiptEmail(deps, result.payment.ref));
}

const refParam = z.object({ ref: z.string().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/) });

/**
 * Plan payment on the website (I4, I13–I17). The sign-in link is public (same answer for every email, rate
 * limited); everything else is the signed-in business OWNER, whose business always comes from the session.
 * No requireActivePlan: an owner whose trial ended must still be able to pay.
 */
export const billingRoutes = new Hono<AppEnv>()
  .post(
    '/sign-in-link',
    rateLimit({ prefix: 'billing-sign-in-link', windowMs: 15 * 60_000, max: 10 }),
    validate('json', webSignInLinkSchema),
    async (c) => {
      await requestWebSignInLink(billingDeps(c), c.req.valid('json').email);
      return c.json({ sent: true });
    },
  )
  .use(requireSession, resolveTenant, requireRole('owner'))
  .get('/overview', async (c) => c.json(await getBillingOverview(billingDeps(c), c.var.tenant.businessId, c.var.userId)))
  .put('/receipt-details', validate('json', receiptDetailsSchema), async (c) =>
    c.json(await saveReceiptDetails(c.var.db, c.var.tenant.businessId, c.req.valid('json'))),
  )
  .post('/checkout', validate('json', checkoutSchema), async (c) =>
    c.json(await createCheckout(billingDeps(c), c.var.tenant.businessId, c.var.userId, c.req.valid('json')), 201),
  )
  .get('/payments', async (c) => c.json(await getBillingHistory(billingDeps(c), c.var.tenant.businessId, c.var.userId)))
  .get('/payments/:ref', validate('param', refParam), async (c) => {
    const deps = billingDeps(c);
    const result = await getBillingPayment(deps, c.var.tenant.businessId, c.req.valid('param').ref);
    afterPlanPaid(deps, result);
    return c.json(result.payment);
  })
  .get('/payments/:ref/receipt.pdf', validate('param', refParam), async (c) => {
    const { filename, pdf } = await getReceiptPdf(c.var.db, c.var.tenant.businessId, c.req.valid('param').ref);
    return c.body(new Uint8Array(pdf), 200, {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    });
  })
  // The app's "Continue with …": a one-time link that opens the website already signed in.
  .post('/web-link', validate('json', webLinkSchema), async (c) => {
    const { plan, page } = c.req.valid('json');
    return c.json(await createWebHandoffLink(billingDeps(c), c.var.userId, plan, page));
  });
