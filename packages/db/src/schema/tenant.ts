import { boolean, char, check, index, integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { citext, createdAt, idPk, updatedAt } from './columns';
import { users } from './auth';

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
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
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
