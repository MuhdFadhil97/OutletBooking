import { Hono } from 'hono';
import { checklistSaveSchema } from '@outletbooking/shared';
import { requireSession } from '../middleware/session';
import { requirePermission, requireActivePlan, resolveTenant } from '../middleware/tenant';
import { getChecklist, saveChecklist, useStandardChecklist } from '../services/inspections';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/** ST-VI-C inspection checklist. Read: any member. Write: owner, or staff with "can change setup". */
export const checklistRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant, requireActivePlan)
  .get('/', async (c) => c.json(await getChecklist(c.var.db, c.var.tenant.businessId)))
  .put('/', requirePermission('canEditSetup'), validate('json', checklistSaveSchema), async (c) =>
    c.json(await saveChecklist(c.var.db, c.var.tenant.businessId, c.req.valid('json'))),
  )
  .post('/standard', requirePermission('canEditSetup'), async (c) =>
    c.json(await useStandardChecklist(c.var.db, c.var.tenant.businessId), 201),
  );
