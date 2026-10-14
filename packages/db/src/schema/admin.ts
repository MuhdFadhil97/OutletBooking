import { check, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { citext, createdAt, idPk, updatedAt } from './columns';
import { users } from './auth';
import { businesses } from './tenant';

// Platform admin (FTech only — not tenant data). docs/schema.sql section 6.

export const platformAdmins = pgTable('platform_admins', {
  id: idPk(),
  userId: integer('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** I2: every admin action is logged, with a reason, in the same transaction as the change. */
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: idPk(),
    adminUserId: integer('admin_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
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
    check(
      'admin_audit_log_action_check',
      sql`${t.action} IN ('extend_trial','pause_booking_page','resume_booking_page','change_plan','note')`,
    ),
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
