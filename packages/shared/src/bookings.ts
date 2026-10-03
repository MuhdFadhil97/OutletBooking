import { z } from 'zod';
import { localDate } from './availability';
import { phoneE164 } from './schemas';

/**
 * Bookings (Phase 3): owner calendar create / reschedule / status, shared by API and app.
 */

export const BOOKING_STATUSES = ['pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_SOURCES = ['web', 'app', 'walk_in'] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

export const PAYMENT_STATUSES = ['not_required', 'unpaid', 'paid', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Allowed status changes. completed / cancelled / no_show are final. */
export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['checked_in', 'completed', 'cancelled', 'no_show'],
  checked_in: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};

/** Status changes staff may make on their own bookings (FR-05). Everything else is owner-only. */
export const STAFF_STATUS_CHANGES: readonly BookingStatus[] = ['checked_in', 'completed', 'no_show'];

export const canTransition = (from: BookingStatus, to: BookingStatus) => BOOKING_TRANSITIONS[from].includes(to);

const isoDateTime = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable();

/** Answers to booking_fields, keyed by field_key. */
export const customFieldsSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  z.union([z.string().trim().max(500), z.number().finite()]),
);

export const bookingCustomerSchema = z.object({
  name: z.string().trim().min(1, 'Enter the customer name').max(100),
  phone: phoneE164,
  email: z.union([z.email(), z.literal('').transform(() => null)]).nullable().optional(),
});

export const bookingCreateSchema = z.object({
  serviceId: z.number().int().positive(),
  /** Omit for "any available" (least busy free resource). */
  resourceId: z.number().int().positive().optional(),
  startAt: isoDateTime,
  /** One of the service's duration options; defaults to the service duration. */
  durationMin: z.number().int().positive().optional(),
  customer: bookingCustomerSchema,
  locationAddress: text(500).optional(),
  customFields: customFieldsSchema.optional(),
  customerNotes: text(1000).optional(),
  internalNotes: text(1000).optional(),
  source: z.enum(['app', 'walk_in']).default('app'),
  /** Owner override: book outside working hours / during time off (double booking is still impossible). */
  allowOutsideHours: z.boolean().default(false),
});
export type BookingCreateInput = z.input<typeof bookingCreateSchema>;
export type BookingCreate = z.infer<typeof bookingCreateSchema>;

export const bookingUpdateSchema = z.object({
  locationAddress: text(500).optional(),
  customFields: customFieldsSchema.optional(),
  customerNotes: text(1000).optional(),
  internalNotes: text(1000).optional(),
  resultNotes: text(5000).optional(),
});
export type BookingUpdate = z.infer<typeof bookingUpdateSchema>;

export const bookingRescheduleSchema = z.object({
  startAt: isoDateTime,
  /** Move to another resource; omit to keep the current one. */
  resourceId: z.number().int().positive().optional(),
  durationMin: z.number().int().positive().optional(),
  allowOutsideHours: z.boolean().default(false),
});
export type BookingRescheduleInput = z.input<typeof bookingRescheduleSchema>;
export type BookingReschedule = z.infer<typeof bookingRescheduleSchema>;

export const bookingStatusSchema = z.object({
  status: z.enum(BOOKING_STATUSES),
  /** Shown on cancelled bookings. */
  reason: text(300).optional(),
});
export type BookingStatusChange = z.infer<typeof bookingStatusSchema>;

const MAX_RANGE_DAYS = 42;

/** Calendar list: bookings overlapping [from, to) local dates (to is exclusive). */
export const bookingListQuery = z
  .object({
    from: localDate,
    to: localDate,
    resourceId: z.coerce.number().int().positive().optional(),
    /** Include cancelled / no-show (hidden by default on the calendar). */
    includeInactive: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .refine((q) => q.to > q.from, { message: 'to must be after from', path: ['to'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= MAX_RANGE_DAYS, {
    message: `At most ${MAX_RANGE_DAYS} days`,
    path: ['to'],
  });
export type BookingListQuery = z.infer<typeof bookingListQuery>;

/** Owner calendar slot lookup: availability + the booking being rescheduled. */
export const calendarAvailabilityQuery = z.object({
  serviceId: z.coerce.number().int().positive(),
  date: localDate,
  durationMin: z.coerce.number().int().positive().optional(),
  resourceId: z.coerce.number().int().positive().optional(),
  excludeBookingId: z.coerce.number().int().positive().optional(),
});

export interface Booking {
  id: number;
  status: BookingStatus;
  source: BookingSource;
  /** ISO (UTC); display in the business timezone. */
  startAt: string;
  endAt: string;
  durationMin: number;
  resource: { id: number; name: string };
  service: { id: number; name: string };
  customer: { id: number; name: string; phone: string; email: string | null };
  priceSen: number;
  amountDueSen: number;
  paymentStatus: PaymentStatus;
  locationAddress: string | null;
  customFields: Record<string, string | number>;
  customerNotes: string | null;
  internalNotes: string | null;
  resultNotes: string | null;
  cancelReason: string | null;
  createdAt: string;
}
