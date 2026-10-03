import { Hono } from 'hono';
import { bookingFieldCreateSchema, bookingFieldUpdateSchema, idParam, reorderSchema } from '@outletbooking/shared';
import { requireSession } from '../middleware/session';
import { requireRole, resolveTenant } from '../middleware/tenant';
import {
  createBookingField,
  deleteBookingField,
  listBookingFields,
  reorderBookingFields,
  updateBookingField,
} from '../services/booking-fields';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/** Read: any member (staff see answers in booking detail). Write: owner. */
export const bookingFieldRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant)
  .get('/', async (c) => c.json(await listBookingFields(c.var.db, c.var.tenant.businessId)))
  .post('/', requireRole('owner'), validate('json', bookingFieldCreateSchema), async (c) =>
    c.json(await createBookingField(c.var.db, c.var.tenant.businessId, c.req.valid('json')), 201),
  )
  .put('/order', requireRole('owner'), validate('json', reorderSchema), async (c) =>
    c.json(await reorderBookingFields(c.var.db, c.var.tenant.businessId, c.req.valid('json').ids)),
  )
  .patch(
    '/:id',
    requireRole('owner'),
    validate('param', idParam),
    validate('json', bookingFieldUpdateSchema),
    async (c) =>
      c.json(await updateBookingField(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .delete('/:id', requireRole('owner'), validate('param', idParam), async (c) => {
    await deleteBookingField(c.var.db, c.var.tenant.businessId, c.req.valid('param').id);
    return c.body(null, 204);
  });
