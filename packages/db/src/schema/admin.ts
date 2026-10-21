import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ADMIN_ACTIONS } from '@outletbooking/shared';
import { citext, createdAt, idPk, updatedAt } from './columns';
import { users } from './auth';
import { businesses } from './tenant';
import { payments } from './bookings';

// Platform admin & website (FTech only — not tenant data). docs/schema.sql section 6.

/** I10 admin users & roles. */
export const platformAdmins = pgTable(
  'platform_admins',
  {
    id: idPk(),
    userId: integer('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('support'),
    isActive: boolean('is_active').notNull().default(true),
    invitedByUserId: integer('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('platform_admins_role_check', sql`${t.role} IN ('support','super_admin')`)],
);

/** I2: every admin action is logged, with a reason, in the same transaction as the change. Insert only (I9 is read-only). */
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: idPk(),
    /** NULL = the system itself (the daily data-deletion job), not a person. */
    adminUserId: integer('admin_user_id').references(() => users.id, { onDelete: 'restrict' }),
    businessId: integer('business_id').references(() => businesses.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    reason: text('reason').notNull(),
    details: jsonb('details')
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('admin_audit_log_business_idx').on(t.businessId, t.createdAt.desc()),
    index('admin_audit_log_admin_idx').on(t.adminUserId, t.createdAt.desc()),
    check(
      'admin_audit_log_action_check',
      sql.raw(`action IN (${ADMIN_ACTIONS.map((a) => `'${a}'`).join(',')})`),
    ),
  ],
);

/** I2 admin-only notes on a business. */
export const adminBusinessNotes = pgTable(
  'admin_business_notes',
  {
    id: idPk(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    adminUserId: integer('admin_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('admin_business_notes_business_idx').on(t.businessId, t.createdAt.desc())],
);

/**
 * I12 plans & prices, shown on the website (I3, I4) and the app (E3). Super admins only.
 * New prices apply to new payments and the next renewal; paid periods keep the price in `payments.amount_sen`.
 */
export const plans = pgTable(
  'plans',
  {
    id: idPk(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    /** Per month. */
    priceSen: integer('price_sen').notNull(),
    resourceLimit: integer('resource_limit').notNull(),
    extraResourceSen: integer('extra_resource_sen').notNull().default(1000),
    /** e.g. {"online_payment":true,"staff_app":true,"reports":true} */
    features: jsonb('features')
      .$type<Record<string, boolean>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    isPublic: boolean('is_public').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('plans_code_check', sql`${t.code} IN ('starter','business')`),
    check('plans_price_sen_check', sql`${t.priceSen} > 0`),
    check('plans_resource_limit_check', sql`${t.resourceLimit} > 0`),
    check('plans_extra_resource_sen_check', sql`${t.extraResourceSen} >= 0`),
  ],
);

/** I12 single-row platform settings (id = 1). */
export const platformSettings = pgTable(
  'platform_settings',
  {
    id: integer('id').primaryKey().default(1),
    trialDays: integer('trial_days').notNull().default(7),
    graceDays: integer('grace_days').notNull().default(3),
    renewalReminderDays: integer('renewal_reminder_days')
      .array()
      .notNull()
      .default(sql`'{7,3,1}'`),
    unpaidDeleteAfterMonths: integer('unpaid_delete_after_months').notNull().default(12),
    deletionNoticeDays: integer('deletion_notice_days').notNull().default(30),
    closeDeleteAfterDays: integer('close_delete_after_days').notNull().default(90),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('platform_settings_id_check', sql`${t.id} = 1`),
    check('platform_settings_trial_days_check', sql`${t.trialDays} BETWEEN 1 AND 90`),
    check('platform_settings_grace_days_check', sql`${t.graceDays} BETWEEN 0 AND 30`),
  ],
);

/** I19 website contact form (no login). Read by FTech in the admin support screen (I11). */
export const leads = pgTable(
  'leads',
  {
    id: idPk(),
    reason: text('reason').notNull(),
    name: text('name').notNull(),
    businessName: text('business_name'),
    phone: text('phone'),
    email: citext('email'),
    businessType: text('business_type'),
    resourceCount: text('resource_count'),
    message: text('message'),
    /** Ticked "FTech may contact me". */
    consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('new'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('leads_status_idx').on(t.status, t.createdAt.desc()),
    check('leads_reason_check', sql`${t.reason} IN ('demo','question','account_help')`),
    check('leads_status_check', sql`${t.status} IN ('new','contacted','won','lost')`),
    check('leads_contact_check', sql`${t.phone} IS NOT NULL OR ${t.email} IS NOT NULL`),
  ],
);

/** I11 support cases. */
export const supportCases = pgTable(
  'support_cases',
  {
    id: idPk(),
    businessId: integer('business_id').references(() => businesses.id, { onDelete: 'set null' }),
    leadId: integer('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    source: text('source').notNull(),
    status: text('status').notNull().default('open'),
    assignedAdminUserId: integer('assigned_admin_user_id').references(() => users.id, { onDelete: 'set null' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('support_cases_status_idx').on(t.status, t.createdAt.desc()),
    index('support_cases_business_idx').on(t.businessId),
    index('support_cases_lead_idx').on(t.leadId),
    index('support_cases_assigned_idx').on(t.assignedAdminUserId),
    check('support_cases_source_check', sql`${t.source} IN ('whatsapp','email','website','phone','other')`),
    check('support_cases_status_check', sql`${t.status} IN ('open','waiting','closed')`),
  ],
);

/** I11 internal notes on a case; `owner_message` = copied in from WhatsApp / email. */
export const supportNotes = pgTable(
  'support_notes',
  {
    id: idPk(),
    caseId: integer('case_id')
      .notNull()
      .references(() => supportCases.id, { onDelete: 'cascade' }),
    adminUserId: integer('admin_user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').notNull().default('internal'),
    body: text('body').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('support_notes_case_idx').on(t.caseId, t.createdAt),
    check('support_notes_kind_check', sql`${t.kind} IN ('internal','owner_message')`),
  ],
);

/** I25 privacy (PDPA) requests. Due 21 days after they are received unless extended with a reason. */
export const privacyRequests = pgTable(
  'privacy_requests',
  {
    id: idPk(),
    requesterName: text('requester_name').notNull(),
    requesterEmail: citext('requester_email'),
    requesterPhone: text('requester_phone'),
    requesterKind: text('requester_kind').notNull(),
    kind: text('kind').notNull(),
    /** The business the data belongs to, if any. */
    businessId: integer('business_id').references(() => businesses.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('open'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp('due_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '21 days'`),
    /** Set when `due_at` is extended. */
    extendedReason: text('extended_reason'),
    checklist: jsonb('checklist')
      .$type<Record<string, boolean>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    notes: text('notes'),
    handledByUserId: integer('handled_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('privacy_requests_open_idx')
      .on(t.dueAt)
      .where(sql`${t.closedAt} IS NULL`),
    index('privacy_requests_business_idx').on(t.businessId),
    index('privacy_requests_handled_by_idx').on(t.handledByUserId),
    check(
      'privacy_requests_requester_kind_check',
      sql`${t.requesterKind} IN ('owner','staff','customer','visitor')`,
    ),
    check(
      'privacy_requests_kind_check',
      sql`${t.kind} IN ('access','correction','deletion','portability','stop_marketing','other')`,
    ),
    check(
      'privacy_requests_status_check',
      sql`${t.status} IN ('open','waiting_id_check','in_progress','sent_to_business','done','rejected')`,
    ),
    check('privacy_requests_contact_check', sql`${t.requesterEmail} IS NOT NULL OR ${t.requesterPhone} IS NOT NULL`),
  ],
);

/** I28 announcements to owners: email, in-app banner on Today (O2), push. */
export const announcements = pgTable(
  'announcements',
  {
    id: idPk(),
    type: text('type').notNull(),
    audience: text('audience').notNull(),
    /** Plan code, template or business slug; NULL when audience = 'all'. */
    audienceValue: text('audience_value'),
    channels: text('channels').array().notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    sendAt: timestamp('send_at', { withTimezone: true }).notNull().defaultNow(),
    /** Banner hidden after this. */
    endsAt: timestamp('ends_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    sentCount: integer('sent_count').notNull().default(0),
    createdByUserId: integer('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('announcements_send_idx')
      .on(t.sendAt)
      .where(sql`${t.sentAt} IS NULL`),
    index('announcements_created_by_idx').on(t.createdByUserId),
    check('announcements_type_check', sql`${t.type} IN ('maintenance','price_change','feature_change','other')`),
    check('announcements_audience_check', sql`${t.audience} IN ('all','plan','template','business')`),
    check(
      'announcements_channels_check',
      sql`cardinality(${t.channels}) > 0 AND ${t.channels} <@ ARRAY['email','in_app','push']`,
    ),
    check('announcements_audience_value_check', sql`(${t.audience} = 'all') = (${t.audienceValue} IS NULL)`),
  ],
);

export const announcementDismissals = pgTable(
  'announcement_dismissals',
  {
    id: idPk(),
    announcementId: integer('announcement_id')
      .notNull()
      .references(() => announcements.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('announcement_dismissals_announcement_id_user_id_key').on(t.announcementId, t.userId),
    index('announcement_dismissals_user_idx').on(t.userId),
  ],
);

/** I27 system health: ToyyibPay payments whose callback and re-check disagree or never arrived. */
export const paymentChecks = pgTable(
  'payment_checks',
  {
    id: idPk(),
    paymentId: integer('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    problem: text('problem').notNull(),
    callbackStatus: text('callback_status'),
    recheckStatus: text('recheck_status'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: integer('resolved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('payment_checks_open_idx')
      .on(t.checkedAt)
      .where(sql`${t.resolvedAt} IS NULL`),
    index('payment_checks_payment_idx').on(t.paymentId),
    index('payment_checks_resolved_by_idx').on(t.resolvedByUserId),
    check(
      'payment_checks_problem_check',
      sql`${t.problem} IN ('callback_recheck_mismatch','no_callback','recheck_failed')`,
    ),
  ],
);

/** I27 system health: email delivery events from Resend webhooks (M1–M7, announcements). */
export const emailEvents = pgTable(
  'email_events',
  {
    id: idPk(),
    businessId: integer('business_id').references(() => businesses.id, { onDelete: 'set null' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    template: text('template').notNull(),
    /** e.g. m***@gmail.com; the full address is not stored here. */
    toMasked: text('to_masked').notNull(),
    /** Resend email id. */
    providerMessageId: text('provider_message_id').unique(),
    status: text('status').notNull().default('sent'),
    details: jsonb('details')
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('email_events_problem_idx')
      .on(t.createdAt.desc())
      .where(sql`${t.status} IN ('bounced','complained','failed')`),
    index('email_events_business_idx').on(t.businessId),
    index('email_events_user_idx').on(t.userId),
    check(
      'email_events_template_check',
      sql`${t.template} IN ('verify_email','reset_password','staff_invite','receipt','trial_ending','sign_in_link','deletion_notice','announcement','refund_note','plan_renewal','change_email','email_changed')`,
    ),
    check(
      'email_events_status_check',
      sql`${t.status} IN ('sent','delivered','bounced','complained','failed')`,
    ),
  ],
);
