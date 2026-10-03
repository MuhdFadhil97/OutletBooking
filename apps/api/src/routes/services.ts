import { Hono } from 'hono';
import { idParam, serviceCreateSchema, serviceUpdateSchema } from '@outletbooking/shared';
import { requireSession } from '../middleware/session';
import { requireRole, resolveTenant } from '../middleware/tenant';
import { archiveService, createService, getService, listServices, updateService } from '../services/service-catalog';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/** Read: any member. Write: owner. */
export const serviceRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant)
  .get('/', async (c) => c.json(await listServices(c.var.db, c.var.tenant.businessId)))
  .get('/:id', validate('param', idParam), async (c) =>
    c.json(await getService(c.var.db, c.var.tenant.businessId, c.req.valid('param').id)),
  )
  .post('/', requireRole('owner'), validate('json', serviceCreateSchema), async (c) =>
    c.json(await createService(c.var.db, c.var.tenant.businessId, c.req.valid('json')), 201),
  )
  .patch('/:id', requireRole('owner'), validate('param', idParam), validate('json', serviceUpdateSchema), async (c) =>
    c.json(await updateService(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .delete('/:id', requireRole('owner'), validate('param', idParam), async (c) => {
    await archiveService(c.var.db, c.var.tenant.businessId, c.req.valid('param').id);
    return c.body(null, 204);
  });
