import { Hono } from 'hono';
import { z } from 'zod';
import { businessProfileUpdateSchema, checklistUpdateSchema } from '@outletbooking/shared';
import { requireSession } from '../middleware/session';
import { requireRole, resolveTenant } from '../middleware/tenant';
import { getSetupChecklist, updateSetupChecklist } from '../services/checklist';
import { getBusiness, getBusinessBySlug, updateBusiness } from '../services/businesses';
import type { AppEnv } from '../types';
import { validate } from '../validate';

export const businessRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant)
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
  .get('/:slug', validate('param', z.object({ slug: z.string().min(1).max(60) })), async (c) =>
    c.json(await getBusinessBySlug(c.var.db, c.var.tenant.businessId, c.req.valid('param').slug)),
  );
