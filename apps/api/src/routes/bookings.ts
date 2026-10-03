import { Hono } from 'hono';
import {
  bookingCreateSchema,
  bookingListQuery,
  bookingRescheduleSchema,
  bookingSearchQuery,
  bookingStatusSchema,
  bookingUpdateSchema,
  calendarAvailabilityQuery,
  idParam,
} from '@outletbooking/shared';
import { requireSession } from '../middleware/session';
import { requireRole, resolveTenant } from '../middleware/tenant';
import { getAvailability } from '../services/availability';
import {
  changeBookingStatus,
  createBooking,
  getBooking,
  listBookings,
  rescheduleBooking,
  searchBookings,
  updateBooking,
} from '../services/bookings';
import { resourceScope } from '../services/resources';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/**
 * Owner calendar (FR-07). Read: owner, or staff limited to their linked resources.
 * Create / edit / reschedule / cancel: owner. Staff may check in, complete and mark no-show.
 */
export const bookingRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant)
  .get('/', validate('query', bookingListQuery), async (c) =>
    c.json(
      await listBookings(c.var.db, c.var.tenant.businessId, c.req.valid('query'), resourceScope(c.var.tenant, c.var.userId)),
    ),
  )
  .get('/search', validate('query', bookingSearchQuery), async (c) =>
    c.json(
      await searchBookings(c.var.db, c.var.tenant.businessId, c.req.valid('query'), resourceScope(c.var.tenant, c.var.userId)),
    ),
  )
  // Calendar slot picker: no advance-notice / max-days limits for the owner.
  .get('/availability', requireRole('owner'), validate('query', calendarAvailabilityQuery), async (c) => {
    const { excludeBookingId, ...query } = c.req.valid('query');
    return c.json(
      await getAvailability(c.var.db, c.var.tenant.businessId, query, { ignoreBookingWindow: true, excludeBookingId }),
    );
  })
  .get('/:id', validate('param', idParam), async (c) =>
    c.json(
      await getBooking(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, resourceScope(c.var.tenant, c.var.userId)),
    ),
  )
  .post('/', requireRole('owner'), validate('json', bookingCreateSchema), async (c) =>
    c.json(await createBooking(c.var.db, c.var.tenant.businessId, c.var.userId, c.req.valid('json')), 201),
  )
  .patch('/:id', requireRole('owner'), validate('param', idParam), validate('json', bookingUpdateSchema), async (c) =>
    c.json(await updateBooking(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .post(
    '/:id/reschedule',
    requireRole('owner'),
    validate('param', idParam),
    validate('json', bookingRescheduleSchema),
    async (c) =>
      c.json(await rescheduleBooking(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .post('/:id/status', validate('param', idParam), validate('json', bookingStatusSchema), async (c) =>
    c.json(
      await changeBookingStatus(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, c.req.valid('json'), {
        role: c.var.tenant.role,
        scope: resourceScope(c.var.tenant, c.var.userId),
      }),
    ),
  );
