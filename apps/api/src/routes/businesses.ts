import { Hono } from 'hono';
import { z } from 'zod';
import {
  businessProfileUpdateSchema,
  checklistUpdateSchema,
  onboardingSetupSchema,
  paymentRuleSchema,
} from '@outletbooking/shared';
import { requireSession } from '../middleware/session';
import { requirePermission, requireRole, requireActivePlan, resolveTenant } from '../middleware/tenant';
import { getSetupChecklist, updateSetupChecklist } from '../services/checklist';
import { getBusiness, getBusinessBySlug, updateBusiness } from '../services/businesses';
import { getPlanInfo } from '../services/plan';
import { finishOnboarding, getSetupSummary, setPaymentRule } from '../services/setup-wizard';
import type { AppEnv } from '../types';
import { validate } from '../validate';

export const businessRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant, requireActivePlan)
  .get('/current', async (c) => c.json(await getBusiness(c.var.db, c.var.tenant.businessId)))
  .patch('/current', requireRole('owner'), validate('json', businessProfileUpdateSchema), async (c) =>
    c.json(await updateBusiness(c.var.db, c.var.tenant.businessId, c.req.valid('json'))),
  )
  // D8 first-time setup checklist (owner Today)
  .get('/current/checklist', requireRole('owner'), async (c) =>
    c.json(await getSetupChecklist(c.var.db, c.var.tenant.businessId)),
  )
  .post('/current/checklist', requireRole('owner'), validate('json', checklistUpdateSchema), async (c) =>
    c.json(await updateSetupChecklist(c.var.db, c.var.tenant.businessId, c.req.valid('json'))),
  )
  // E3 choose a plan / E4 trial ended (paid on the website)
  .get('/current/plan', requireRole('owner'), async (c) =>
    c.json(await getPlanInfo(c.var.db, c.var.tenant.businessId, c.var.env.WEBSITE_URL)),
  )
  // ST Setup tab summary (owner, or staff who can change setup)
  .get('/current/setup', requirePermission('canEditSetup'), async (c) =>
    c.json(await getSetupSummary(c.var.db, c.var.tenant.businessId)),
  )
  // Setup "Payment to confirm": one rule for every service
  .put('/current/payment-rule', requirePermission('canEditSetup'), validate('json', paymentRuleSchema), async (c) =>
    c.json(await setPaymentRule(c.var.db, c.var.tenant.businessId, c.req.valid('json').rule)),
  )
  // O1c sign-up step 3 "Finish" (owner, once)
  .post('/current/onboarding', requireRole('owner'), validate('json', onboardingSetupSchema), async (c) =>
    c.json(await finishOnboarding(c.var.db, c.var.tenant.businessId, c.var.userId, c.req.valid('json')), 201),
  )
  .get('/:slug', validate('param', z.object({ slug: z.string().min(1).max(60) })), async (c) =>
    c.json(await getBusinessBySlug(c.var.db, c.var.tenant.businessId, c.req.valid('param').slug)),
  );
