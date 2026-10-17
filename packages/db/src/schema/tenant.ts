import { boolean, char, check, index, integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { citext, createdAt, idPk, updatedAt } from './columns';
import { users } from './auth';
import type { NotificationPrefKey } from '@outletbooking/shared';

export const businesses = pgTable(
  'businesses',
  {
    id: idPk(),
    slug: citext('slug').notNull().unique(),
    name: text('name').notNull(),
    template: text('template').notNull().default('other'),
    phone: text('phone'),
    whatsappPhone: text('whatsapp_phone'),
    email: citext('email'),
    address: text('address'),
    description: text('description'),
    logoKey: text('logo_key'),
    timezone: text('timezone').notNull().default('Asia/Kuala_Lumpur'),
    currency: char('currency', { length: 3 }).notNull().default('MYR'),
    resourceLabel: text('resource_label').notNull().default('Resource'),
    slotIntervalMin: integer('slot_interval_min').notNull().default(30),
    minAdvanceMin: integer('min_advance_min').notNull().default(60),
    maxDaysAhead: integer('max_days_ahead').notNull().default(30),
    cancelCutoffMin: integer('cancel_cutoff_min').notNull().default(120),
    pendingExpiryMin: integer('pending_expiry_min').notNull().default(15),
    /** false = booking page paused (F3). */
    bookingEnabled: boolean('booking_enabled').notNull().default(true),
    /** E6: paid web bookings confirm automatically. */
    autoConfirmPaid: boolean('auto_confirm_paid').notNull().default(true),
    /** E6 / F5: customers may cancel from their booking link (before cancel_cutoff_min). */
    customersCanCancel: boolean('customers_can_cancel').notNull().default(true),
    /** E6: a cancellation inside the cutoff keeps the deposit. */
    lateCancelKeepsDeposit: boolean('late_cancel_keeps_deposit').notNull().default(true),
    /** Template-specific settings: mobile fee/area, report options, travel areas… */
    settings: jsonb('settings')
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Platform admin (I2, I26)
    /** Suspended for misuse: app + booking page locked. */
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendReason: text('suspend_reason'),
    /** Owner asked to close; data deleted 90 days later. */
    closeRequestedAt: timestamp('close_requested_at', { withTimezone: true }),
    /** M7 sent. */
    deletionNoticeSentAt: timestamp('deletion_notice_sent_at', { withTimezone: true }),
    /** The daily job deletes tenant data on/after this date. */
    deletionDueAt: timestamp('deletion_due_at', { withTimezone: true }),
    /** Set = deletion paused by an admin. */
    deletionHoldReason: text('deletion_hold_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Tenant data deleted; row kept (name only) for FTech's receipts. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('businesses_deletion_due_idx')
      .on(t.deletionDueAt)
      .where(sql`${t.deletionDueAt} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    check('businesses_suspend_check', sql`(${t.suspendedAt} IS NULL) = (${t.suspendReason} IS NULL)`),
    check('businesses_slug_check', sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{2,49}$'`),
    check(
      'businesses_template_check',
      sql`${t.template} IN ('real_estate','vehicle_inspection','sports','workshop','barber_salon','clinic','tuition','other')`,
    ),
    check('businesses_slot_interval_min_check', sql`${t.slotIntervalMin} BETWEEN 5 AND 240`),
    check('businesses_min_advance_min_check', sql`${t.minAdvanceMin} >= 0`),
    check('businesses_max_days_ahead_check', sql`${t.maxDaysAhead} BETWEEN 1 AND 365`),
    check('businesses_cancel_cutoff_min_check', sql`${t.cancelCutoffMin} >= 0`),
    check('businesses_pending_expiry_min_check', sql`${t.pendingExpiryMin} BETWEEN 5 AND 1440`),
  ],
);

export const businessMembers = pgTable(
  'business_members',
  {
    id: idPk(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    /** Staff may see all bookings, not only their linked resources. */
    canViewAll: boolean('can_view_all').notNull().default(false),
    /** Record cash / DuitNow / card payments (D12, S2, H7). */
    canTakePayments: boolean('can_take_payments').notNull().default(true),
    /** Edit services, prices, hours (D12). */
    canEditSetup: boolean('can_edit_setup').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    /** G3 push switches, e.g. {"daySummary": false}. A missing key means on. */
    notificationPrefs: jsonb('notification_prefs')
      .$type<Partial<Record<NotificationPrefKey, boolean>>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('business_members_business_id_user_id_key').on(t.businessId, t.userId),
    index('business_members_user_id_idx').on(t.userId),
    check('business_members_role_check', sql`${t.role} IN ('owner','staff')`),
  ],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: idPk(),
    businessId: integer('business_id')
      .notNull()
      .unique()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    plan: text('plan').notNull().default('trial'),
    status: text('status').notNull().default('trialing'),
    resourceLimit: integer('resource_limit').notNull().default(10),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '7 days'`),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    /** Free months given by an admin (I2); no payment created. */
    freeUntil: timestamp('free_until', { withTimezone: true }),
    /**
     * Renewal notices (reminder, grace, ended) already sent for the period that ended at `renewal_notice_for`:
     * `renewal_notice_stage` = days before the end of the last reminder sent (7, 3, 1), 0 = "plan ended, grace
     * running", -1 = "grace over, page paused". A new period (new end date) starts again from nothing.
     */
    renewalNoticeFor: timestamp('renewal_notice_for', { withTimezone: true }),
    renewalNoticeStage: integer('renewal_notice_stage'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('subscriptions_plan_check', sql`${t.plan} IN ('trial','starter','business')`),
    check(
      'subscriptions_status_check',
      sql`${t.status} IN ('trialing','active','past_due','expired','cancelled')`,
    ),
  ],
);

/**
 * I4 / I17 receipt details for plan payments: who the receipt is made out to. One row per business.
 * Each paid plan payment keeps its own copy (`payments.receipt_snapshot`), so changing these only affects new receipts.
 */
export const billingDetails = pgTable('billing_details', {
  id: idPk(),
  businessId: integer('business_id')
    .notNull()
    .unique()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  companyName: text('company_name').notNull(),
  /** SSM registration no. (optional). */
  ssmNo: text('ssm_no'),
  /** Tax identification no. for a future LHDN e-Invoice (optional). */
  tin: text('tin'),
  address: text('address'),
  receiptEmail: citext('receipt_email').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
