import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { citext, createdAt, idPk, updatedAt } from './columns';
import { users } from './auth';
import { businesses } from './tenant';
import { branches, resources, services } from './setup';

/** Per-business customer, unique by phone (E.164). */
export const customers = pgTable(
  'customers',
  {
    id: idPk(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    email: citext('email'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    unique('customers_business_id_phone_key').on(t.businessId, t.phone),
    unique('customers_business_id_id_key').on(t.businessId, t.id),
    check('customers_phone_check', sql`${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
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
