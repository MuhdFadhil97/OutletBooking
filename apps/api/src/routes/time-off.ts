import { Hono } from 'hono';
import { idParam, timeOffCreateSchema, timeOffQuery, timeOffUpdateSchema } from '@outletbooking/shared';
import { requireSession } from '../middleware/session';
import { requireRole, resolveTenant } from '../middleware/tenant';
import { createTimeOff, deleteTimeOff, listTimeOff, updateTimeOff } from '../services/time-off';
import type { AppEnv } from '../types';
import { validate } from '../validate';

export const timeOffRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant, requireRole('owner'))
  .get('/', validate('query', timeOffQuery), async (c) =>
    c.json(await listTimeOff(c.var.db, c.var.tenant.businessId, c.req.valid('query'))),
  )
  .post('/', validate('json', timeOffCreateSchema), async (c) =>
    c.json(await createTimeOff(c.var.db, c.var.tenant.businessId, c.req.valid('json')), 201),
  )
  .patch('/:id', validate('param', idParam), validate('json', timeOffUpdateSchema), async (c) =>
    c.json(await updateTimeOff(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .delete('/:id', validate('param', idParam), async (c) => {
    await deleteTimeOff(c.var.db, c.var.tenant.businessId, c.req.valid('param').id);
    return c.body(null, 204);
  });
