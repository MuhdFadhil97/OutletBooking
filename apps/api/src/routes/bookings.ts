import { Hono, type Context } from 'hono';
import {
  bookingCreateSchema,
  bookingExtendSchema,
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
import { listBookingEvents } from '../services/booking-events';
import {
  bookingScope,
  changeBookingStatus,
  createBooking,
  extendBooking,
  getBooking,
  listBookings,
  rescheduleBooking,
  searchBookings,
  updateBooking,
} from '../services/bookings';
import type { AppEnv } from '../types';
import { validate } from '../validate';

/** The caller's booking scope (linked resources, hidden answers), from the tenant middleware. */
const scopeOf = (c: Context<AppEnv>) => bookingScope(c.var.db, c.var.tenant, c.var.userId);

/**
 * Owner calendar (FR-07). Read: owner, or staff limited to their linked resources.
 * Create / edit / reschedule / cancel: owner. Staff may check in, complete and mark no-show.
 */
export const bookingRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant)
  .get('/', validate('query', bookingListQuery), async (c) =>
    c.json(await listBookings(c.var.db, c.var.tenant.businessId, c.req.valid('query'), await scopeOf(c))),
  )
  .get('/search', validate('query', bookingSearchQuery), async (c) =>
    c.json(await searchBookings(c.var.db, c.var.tenant.businessId, c.req.valid('query'), await scopeOf(c))),
  )
  // Calendar slot picker: no advance-notice / max-days limits for the owner.
  .get('/availability', requireRole('owner'), validate('query', calendarAvailabilityQuery), async (c) => {
    const { excludeBookingId, ...query } = c.req.valid('query');
    return c.json(
      await getAvailability(c.var.db, c.var.tenant.businessId, query, { ignoreBookingWindow: true, excludeBookingId }),
    );
  })
  .get('/:id', validate('param', idParam), async (c) =>
    c.json(await getBooking(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, await scopeOf(c))),
  )
  // O4 timeline. getBooking first: 404 for bookings outside the business or the staff member's resources.
  .get('/:id/events', validate('param', idParam), async (c) => {
    const { businessId } = c.var.tenant;
    const { id } = c.req.valid('param');
    await getBooking(c.var.db, businessId, id, await scopeOf(c));
    return c.json(await listBookingEvents(c.var.db, businessId, id));
  })
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
      c.json(
        await rescheduleBooking(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, c.req.valid('json'), c.var.userId),
      ),
  )
  .post('/:id/extend', requireRole('owner'), validate('param', idParam), validate('json', bookingExtendSchema), async (c) =>
    c.json(await extendBooking(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, c.req.valid('json'), c.var.userId)),
  )
  .post('/:id/status', validate('param', idParam), validate('json', bookingStatusSchema), async (c) =>
    c.json(
      await changeBookingStatus(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, c.req.valid('json'), {
        userId: c.var.userId,
        role: c.var.tenant.role,
        scope: await scopeOf(c),
      }),
    ),
  );
