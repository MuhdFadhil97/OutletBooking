import { Hono } from 'hono';
import { customerCreateSchema, customerListQuery, customerUpdateSchema, idParam } from '@outletbooking/shared';
import { requireSession } from '../middleware/session';
import { requireRole, requireActivePlan, resolveTenant } from '../middleware/tenant';
import { createCustomer, eraseCustomer, getCustomer, listCustomers, updateCustomer } from '../services/customers';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/** D10 / D11 customers (FR-12): owner only. PDPA erase anonymises; bookings and payments stay. */
export const customerRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant, requireActivePlan, requireRole('owner'))
  .get('/', validate('query', customerListQuery), async (c) =>
    c.json(await listCustomers(c.var.db, c.var.tenant.businessId, c.req.valid('query'))),
  )
  .post('/', validate('json', customerCreateSchema), async (c) =>
    c.json(await createCustomer(c.var.db, c.var.tenant.businessId, c.req.valid('json')), 201),
  )
  .get('/:id', validate('param', idParam), async (c) =>
    c.json(await getCustomer(c.var.db, c.var.tenant.businessId, c.req.valid('param').id)),
  )
  .patch('/:id', validate('param', idParam), validate('json', customerUpdateSchema), async (c) =>
    c.json(await updateCustomer(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .post('/:id/erase', validate('param', idParam), async (c) => {
    await eraseCustomer(c.var.db, c.var.tenant.businessId, c.req.valid('param').id);
    return c.body(null, 204);
  });
