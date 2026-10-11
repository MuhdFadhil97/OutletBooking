import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  ATTACHMENT_MAX_BYTES,
  attachmentParam,
  bookingCreateSchema,
  bookingResultSchema,
  bookingExtendSchema,
  bookingListQuery,
  bookingRescheduleSchema,
  bookingSearchQuery,
  bookingStatusSchema,
  bookingUpdateSchema,
  calendarAvailabilityQuery,
  idParam,
  recordPaymentSchema,
  reminderListQuery,
} from '@outletbooking/shared';
import { requireSession } from '../middleware/session';
import { requirePermission, requireRole, requireActivePlan, resolveTenant } from '../middleware/tenant';
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
import { AppError } from '../errors';
import { createBookingPaymentLink, recordManualPayment } from '../services/payments';
import { addAttachment, deleteAttachment, listAttachments, setResultNotes } from '../services/staff-app';
import { listReminders, markReminderSent } from '../services/reminders';
import type { AppEnv } from '../types';
import { paymentDeps } from './payments';
import { validate } from '../validate';

/** The caller's booking scope (linked resources, hidden answers), from the tenant middleware. */
const scopeOf = (c: Context<AppEnv>) => bookingScope(c.var.db, c.var.tenant, c.var.userId);

/**
 * Owner calendar (FR-07). Read: owner, or staff limited to their linked resources.
 * Create / edit / reschedule / cancel: owner. Staff may check in, complete and mark no-show.
 */
export const bookingRoutes = new Hono<AppEnv>()
  .use(requireSession, resolveTenant, requireActivePlan)
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
  // D5 · Remind tomorrow's customers (before /:id so "reminders" is not read as an id).
  .get('/reminders', validate('query', reminderListQuery), async (c) =>
    c.json(await listReminders(c.var.db, c.var.tenant.businessId, c.req.valid('query').date, await scopeOf(c))),
  )
  .get('/:id', validate('param', idParam), async (c) =>
    c.json(await getBooking(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, await scopeOf(c))),
  )
  // O4 timeline. getBooking first: 404 for bookings outside the business or the staff member's resources.
  .post('/:id/reminder', validate('param', idParam), async (c) =>
    c.json(await markReminderSent(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, c.var.userId, await scopeOf(c))),
  )
  // H7 · Resend pay link (ToyyibPay bill on the business's own account) and record a payment taken in person.
  .post('/:id/pay-link', requirePermission('canTakePayments'), validate('param', idParam), async (c) =>
    c.json(
      await createBookingPaymentLink(
        paymentDeps(c),
        { businessId: c.var.tenant.businessId, bookingId: c.req.valid('param').id, scope: await scopeOf(c) },
        { actorUserId: c.var.userId },
      ),
    ),
  )
  .post(
    '/:id/payments',
    requirePermission('canTakePayments'),
    validate('param', idParam),
    validate('json', recordPaymentSchema),
    async (c) =>
      c.json(
        await recordManualPayment(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, c.req.valid('json'), {
          userId: c.var.userId,
          scope: await scopeOf(c),
        }),
        201,
      ),
  )
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
  // S2 · Result notes and photos: owner, or staff on their own bookings.
  .put('/:id/result', validate('param', idParam), validate('json', bookingResultSchema), async (c) =>
    c.json(
      await setResultNotes(c.var.db, c.var.tenant.businessId, c.req.valid('param').id, c.req.valid('json'), await scopeOf(c)),
    ),
  )
  .get('/:id/attachments', validate('param', idParam), async (c) =>
    c.json(
      await listAttachments(c.var.db, c.var.storage, c.var.tenant.businessId, c.req.valid('param').id, await scopeOf(c)),
    ),
  )
  .post(
    '/:id/attachments',
    bodyLimit({
      maxSize: ATTACHMENT_MAX_BYTES + 64 * 1024,
      onError: () => {
        throw new AppError(400, 'file_too_large', 'Photos must be smaller than 10 MB');
      },
    }),
    validate('param', idParam),
    async (c) => {
      const body = await c.req.parseBody();
      const file = body['file'];
      if (!(file instanceof File)) throw new AppError(400, 'file_missing', 'Choose a photo to upload');
      return c.json(
        await addAttachment(
          c.var.db,
          c.var.storage,
          {
            businessId: c.var.tenant.businessId,
            bookingId: c.req.valid('param').id,
            userId: c.var.userId,
            scope: await scopeOf(c),
          },
          { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type },
        ),
        201,
      );
    },
  )
  .delete('/:id/attachments/:attachmentId', validate('param', attachmentParam), async (c) => {
    const { id, attachmentId } = c.req.valid('param');
    await deleteAttachment(
      c.var.db,
      c.var.storage,
      {
        businessId: c.var.tenant.businessId,
        bookingId: id,
        userId: c.var.userId,
        isOwner: c.var.tenant.role === 'owner',
        scope: await scopeOf(c),
      },
      attachmentId,
    );
    return c.body(null, 204);
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
