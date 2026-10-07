import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { citext, createdAt, idPk, updatedAt } from './columns';
import { users } from './auth';
import { businesses } from './tenant';
import { BOOKING_EVENT_TYPES, type BookingEventType } from '@outletbooking/shared';
import { branches, resources, services } from './setup';

/** Per-business customer, unique by phone (E.164). PDPA erase anonymises the row (phone → NULL). */
export const customers = pgTable(
  'customers',
  {
    id: idPk(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** E.164; NULL after PDPA erase. */
    phone: text('phone'),
    email: citext('email'),
    notes: text('notes'),
    /** PDPA erase (D11): name → 'Deleted customer', phone/email/notes → NULL. */
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    unique('customers_business_id_phone_key').on(t.businessId, t.phone),
    unique('customers_business_id_id_key').on(t.businessId, t.id),
    check('customers_phone_check', sql`${t.phone} IS NULL OR ${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
  ],
);

/**
 * Appointments. Double booking is blocked by the `bookings_no_overlap` exclusion constraint
 * (custom migration 0006): same resource, overlapping blocked range, status pending/confirmed/checked_in.
 */
export const bookings = pgTable(
  'bookings',
  {
    id: idPk(),
    /** Used in confirmation / cancel links instead of the integer id. */
    publicToken: text('public_token')
      .notNull()
      .unique()
      .default(sql`encode(gen_random_bytes(16), 'hex')`),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'restrict' }),
    branchId: integer('branch_id'),
    resourceId: integer('resource_id').notNull(),
    serviceId: integer('service_id').notNull(),
    customerId: integer('customer_id').notNull(),

    /** What the customer sees. */
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    /** start_at - travel buffer (set by the API). */
    blockedStartAt: timestamp('blocked_start_at', { withTimezone: true }).notNull(),
    /** end_at + buffer / travel buffer (set by the API). */
    blockedEndAt: timestamp('blocked_end_at', { withTimezone: true }).notNull(),
    durationMin: integer('duration_min').notNull(),

    status: text('status').notNull().default('pending'),
    source: text('source').notNull().default('web'),
    priceSen: integer('price_sen').notNull().default(0),
    /** Deposit or full prepayment. */
    amountDueSen: integer('amount_due_sen').notNull().default(0),
    paymentStatus: text('payment_status').notNull().default('not_required'),

    /** Property viewing / mobile inspection address. */
    locationAddress: text('location_address'),
    /** Answers to booking_fields, e.g. {"plate_number":"WXY1234"}. */
    customFields: jsonb('custom_fields')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    customerNotes: text('customer_notes'),
    internalNotes: text('internal_notes'),
    /** Inspection result, etc. */
    resultNotes: text('result_notes'),

    /** Pending payment expiry. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** D5 remind tomorrow's customers. */
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    /** NULL = booked by the customer on the web page. */
    createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('bookings_business_id_id_key').on(t.businessId, t.id),
    foreignKey({
      name: 'bookings_business_id_branch_id_fkey',
      columns: [t.businessId, t.branchId],
      foreignColumns: [branches.businessId, branches.id],
    }),
    foreignKey({
      name: 'bookings_business_id_resource_id_fkey',
      columns: [t.businessId, t.resourceId],
      foreignColumns: [resources.businessId, resources.id],
    }),
    foreignKey({
      name: 'bookings_business_id_service_id_fkey',
      columns: [t.businessId, t.serviceId],
      foreignColumns: [services.businessId, services.id],
    }),
    foreignKey({
      name: 'bookings_business_id_customer_id_fkey',
      columns: [t.businessId, t.customerId],
      foreignColumns: [customers.businessId, customers.id],
    }),
    index('bookings_business_start_idx').on(t.businessId, t.startAt),
    index('bookings_resource_start_idx').on(t.resourceId, t.startAt),
    index('bookings_customer_idx').on(t.customerId),
    index('bookings_pending_expiry_idx').on(t.expiresAt).where(sql`${t.status} = 'pending'`),
    index('bookings_custom_fields_gin').using('gin', t.customFields.op('jsonb_path_ops')),
    check('bookings_duration_min_check', sql`${t.durationMin} > 0`),
    check(
      'bookings_status_check',
      sql`${t.status} IN ('pending','confirmed','checked_in','completed','cancelled','no_show')`,
    ),
    check('bookings_source_check', sql`${t.source} IN ('web','app','walk_in')`),
    check('bookings_price_sen_check', sql`${t.priceSen} >= 0`),
    check('bookings_amount_due_sen_check', sql`${t.amountDueSen} >= 0`),
    check(
      'bookings_payment_status_check',
      sql`${t.paymentStatus} IN ('not_required','unpaid','paid','refunded')`,
    ),
    check('bookings_time_check', sql`${t.endAt} > ${t.startAt}`),
    check(
      'bookings_blocked_range_check',
      sql`${t.blockedStartAt} <= ${t.startAt} AND ${t.blockedEndAt} >= ${t.endAt}`,
    ),
  ],
);

/** Booking timeline. Every status change writes a row in the same transaction. */
export const bookingEvents = pgTable(
  'booking_events',
  {
    id: idPk(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    bookingId: integer('booking_id').notNull(),
    eventType: text('event_type').$type<BookingEventType>().notNull(),
    /** NULL = customer or system. */
    actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    details: jsonb('details')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'booking_events_business_id_booking_id_fkey',
      columns: [t.businessId, t.bookingId],
      foreignColumns: [bookings.businessId, bookings.id],
    }).onDelete('cascade'),
    index('booking_events_booking_idx').on(t.bookingId, t.createdAt),
    index('booking_events_business_id_idx').on(t.businessId),
    check(
      'booking_events_event_type_check',
      sql.raw(`event_type IN (${BOOKING_EVENT_TYPES.map((e) => `'${e}'`).join(',')})`),
    ),
  ],
);

/**
 * D4: refunds are paid outside the app (bank transfer / DuitNow / cash) and only recorded here.
 * `payment_id` gets its FK to `payments` in the Phase 5 migration that creates that table.
 */
export const refunds = pgTable(
  'refunds',
  {
    id: idPk(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'restrict' }),
    bookingId: integer('booking_id').notNull(),
    paymentId: integer('payment_id'),
    amountSen: integer('amount_sen').notNull(),
    method: text('method').notNull(),
    reason: text('reason'),
    recordedByUserId: integer('recorded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'refunds_business_id_booking_id_fkey',
      columns: [t.businessId, t.bookingId],
      foreignColumns: [bookings.businessId, bookings.id],
    }).onDelete('restrict'),
    index('refunds_booking_idx').on(t.bookingId),
    index('refunds_business_id_idx').on(t.businessId),
    check('refunds_amount_sen_check', sql`${t.amountSen} > 0`),
    check('refunds_method_check', sql`${t.method} IN ('bank_transfer','duitnow','cash')`),
  ],
);
