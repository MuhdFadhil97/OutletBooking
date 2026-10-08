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

/** booking_events.event_type — every status change writes one in the same transaction. */
export const BOOKING_EVENT_TYPES = [
  'created',
  'confirmed',
  'paid',
  'payment_failed',
  'pay_link_sent',
  'reminder_sent',
  'rescheduled',
  'checked_in',
  'completed',
  'extended',
  'no_show',
  'cancelled',
  'refunded',
  'expired',
] as const;
export type BookingEventType = (typeof BOOKING_EVENT_TYPES)[number];

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
/** Public booking page (no login): same fields minus owner-only ones (source, outside-hours override, internal notes). */
export const publicBookingCreateSchema = bookingCreateSchema.pick({
  serviceId: true,
  resourceId: true,
  startAt: true,
  durationMin: true,
  customer: true,
  locationAddress: true,
  customFields: true,
  customerNotes: true,
});
export type PublicBookingCreateInput = z.input<typeof publicBookingCreateSchema>;
export type PublicBookingCreate = z.infer<typeof publicBookingCreateSchema>;
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

/** D4: refunds are paid outside the app (bank transfer / DuitNow / cash) and only recorded. */
export const REFUND_METHODS = ['bank_transfer', 'duitnow', 'cash'] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

/** D4 · Cancel booking (owner): reason, plus an optional refund of what the customer paid. */
export const bookingCancelSchema = z.object({
  reason: text(300).optional(),
  refund: z
    .object({
      amountSen: z.number().int().positive().max(100_000_000),
      method: z.enum(REFUND_METHODS),
    })
    .optional(),
});
export type BookingCancelInput = z.input<typeof bookingCancelSchema>;
export type BookingCancel = z.infer<typeof bookingCancelSchema>;

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

export const BOOKING_SEARCH_FILTERS = ['all', 'upcoming', 'unpaid', 'past'] as const;
export type BookingSearchFilter = (typeof BOOKING_SEARCH_FILTERS)[number];

/**
 * Bookings tab (O9): search by customer name, phone or searchable booking answers (e.g. plate number).
 * Sorted upcoming first (soonest), then past (most recent).
 */
export const bookingSearchQuery = z.object({
  q: z.string().trim().max(100).optional(),
  filter: z.enum(BOOKING_SEARCH_FILTERS).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type BookingSearchQuery = z.infer<typeof bookingSearchQuery>;

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
  /** Short reference to quote on the phone / WhatsApp, e.g. "2P9C". */
  ref: string;
  /**
   * phone is null once the customer has been anonymised (PDPA erase).
   * bookingCount: this customer's bookings at the business, cancelled ones not counted ("2nd visit").
   */
  customer: { id: number; name: string; phone: string | null; email: string | null; bookingCount: number };
  priceSen: number;
  amountDueSen: number;
  paymentStatus: PaymentStatus;
  /** Recorded refunds (paid outside the app). */
  refundedSen: number;
  /** Payments received (online + recorded by hand). */
  paidSen: number;
  /** Unpaid pending bookings are released at this time (H7 countdown). */
  expiresAt: string | null;
  /** D5 · reminder sent to the customer. */
  reminderSentAt: string | null;
  locationAddress: string | null;
  customFields: Record<string, string | number>;
  customerNotes: string | null;
  internalNotes: string | null;
  resultNotes: string | null;
  cancelReason: string | null;
  createdAt: string;
}

/** O4 timeline entry. `actor` is null for the customer (web page) or the system. */
export interface BookingEvent {
  id: number;
  type: BookingEventType;
  actor: { id: number; name: string } | null;
  details: Record<string, unknown>;
  createdAt: string;
}

/** D5 · default "remind tomorrow's customers" WhatsApp message. Placeholders in {braces}. */
export const DEFAULT_REMINDER_TEMPLATE =
  "Hi {name}, a reminder of your {service} booking at {business} tomorrow, {time} on {resource}. Can't make it? Reply to this message.";
export const REMINDER_PLACEHOLDERS = ['name', 'service', 'business', 'time', 'date', 'resource', 'ref'] as const;
export type ReminderVars = Record<(typeof REMINDER_PLACEHOLDERS)[number], string>;

/** Fills {name}, {service}… — unknown placeholders are left as typed. */
export function fillReminder(template: string, vars: ReminderVars): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) => (key in vars ? vars[key as keyof ReminderVars] : all));
}
