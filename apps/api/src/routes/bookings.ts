import { Hono, type Context } from 'hono';
import {
  bookingCancelSchema,
  bookingCreateSchema,
  bookingListQuery,
  bookingRescheduleSchema,
  bookingSearchQuery,
  bookingStatusSchema,
  bookingUpdateSchema,
  calendarAvailabilityQuery,
  idParam,
  manualPaymentSchema,
} from '@outletbooking/shared';
import { requireSession } from '../middleware/session';
import { requirePermission, requireRole, resolveTenant } from '../middleware/tenant';
import { getAvailability } from '../services/availability';
import { listBookingEvents } from '../services/booking-events';
import { Outbox } from '../services/notifications';
import { listBookingPayments, payLinkForBooking, recordManualPayment } from '../services/payments';
import { recordBookingEvent } from '../services/booking-events';
import {
  bookingScope,
  cancelBooking,
  changeBookingStatus,
  createBooking,
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
  // H7 · payments on this booking (+ the open pay link)
  .get('/:id/payments', validate('param', idParam), async (c) => {
    const { businessId } = c.var.tenant;
    const { id } = c.req.valid('param');
    await getBooking(c.var.db, businessId, id, await scopeOf(c));
    return c.json(await listBookingPayments(c.var.db, c.var.payments, businessId, id));
  })
  // H7 · record cash / DuitNow QR / card / bank transfer
  .post(
    '/:id/payments',
    requirePermission('canTakePayments'),
    validate('param', idParam),
    validate('json', manualPaymentSchema),
    async (c) => {
      const { businessId } = c.var.tenant;
      const { id } = c.req.valid('param');
      await getBooking(c.var.db, businessId, id, await scopeOf(c));
      await recordManualPayment(c.var.db, businessId, id, c.var.userId, c.req.valid('json'));
      return c.json(await getBooking(c.var.db, businessId, id, await scopeOf(c)), 201);
    },
  )
  // H7 · "Resend pay link": the ToyyibPay page to send on WhatsApp (logged on the timeline).
  .post('/:id/pay-link', requirePermission('canTakePayments'), validate('param', idParam), async (c) => {
    const { businessId } = c.var.tenant;
    const { id } = c.req.valid('param');
    await getBooking(c.var.db, businessId, id, await scopeOf(c));
    const link = await payLinkForBooking(c.var.db, c.var.payments, businessId, id);
    await c.var.db.transaction((tx) =>
      recordBookingEvent(tx, { businessId, bookingId: id, type: 'pay_link_sent', actorUserId: c.var.userId }),
    );
    return c.json({ url: link.url });
  })
  .post('/', requireRole('owner'), validate('json', bookingCreateSchema), async (c) => {
    const outbox = new Outbox();
    const result = await createBooking(c.var.db, c.var.tenant.businessId, c.var.userId, c.req.valid('json'), outbox);
    void outbox.flush(c.var.db, c.var.push);
    return c.json(result, 201);
  })
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
  // D4 · cancel with reason and optional refund (owner)
  .post('/:id/cancel', requireRole('owner'), validate('param', idParam), validate('json', bookingCancelSchema), async (c) => {
    const outbox = new Outbox();
    const { businessId } = c.var.tenant;
    const result = await cancelBooking(c.var.db, businessId, c.req.valid('param').id, c.req.valid('json'), c.var.userId, outbox);
    void outbox.flush(c.var.db, c.var.push);
    return c.json(result);
  })
  .post('/:id/status', validate('param', idParam), validate('json', bookingStatusSchema), async (c) =>
    c.json(
      await changeBookingStatus(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, c.req.valid('json'), {
        userId: c.var.userId,
        role: c.var.tenant.role,
        scope: await scopeOf(c),
      }),
    ),
  );
