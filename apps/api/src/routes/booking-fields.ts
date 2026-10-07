import { Hono } from 'hono';
import { bookingFieldCreateSchema, bookingFieldUpdateSchema, idParam, reorderSchema } from '@outletbooking/shared';
import { requireSession } from '../middleware/session';
import { requirePermission, resolveTenant } from '../middleware/tenant';
import {
  createBookingField,
  deleteBookingField,
  listBookingFields,
  reorderBookingFields,
  updateBookingField,
} from '../services/booking-fields';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/** Read: any member (staff see answers in booking detail). Write: owner, or staff with "can change setup". */
export const bookingFieldRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant)
  .get('/', async (c) => {
    const all = await listBookingFields(c.var.db, c.var.tenant.businessId);
    // Questions hidden from staff are only listed for members who can change setup.
    return c.json(c.var.tenant.canEditSetup ? all : all.filter((f) => f.showToStaff));
  })
  .post('/', requirePermission('canEditSetup'), validate('json', bookingFieldCreateSchema), async (c) =>
    c.json(await createBookingField(c.var.db, c.var.tenant.businessId, c.req.valid('json')), 201),
  )
  .put('/order', requirePermission('canEditSetup'), validate('json', reorderSchema), async (c) =>
    c.json(await reorderBookingFields(c.var.db, c.var.tenant.businessId, c.req.valid('json').ids)),
  )
  .patch(
    '/:id',
    requirePermission('canEditSetup'),
    validate('param', idParam),
    validate('json', bookingFieldUpdateSchema),
    async (c) =>
      c.json(await updateBookingField(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .delete('/:id', requirePermission('canEditSetup'), validate('param', idParam), async (c) => {
    await deleteBookingField(c.var.db, c.var.tenant.businessId, c.req.valid('param').id);
    return c.body(null, 204);
  });
