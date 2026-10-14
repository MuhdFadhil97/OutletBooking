import { z } from 'zod';
import { hasPlanAccess, type PlanAccessInput } from './plans';
import type { SubscriptionStatus } from './types';
import type { BusinessTemplate } from './templates';

/**
 * I1 / I2 platform admin (FTech only, desktop web in apps/web).
 * Admins never see ToyyibPay keys or customers' payment details — only "connected" and counts.
 */

/** Every admin change writes one of these to `admin_audit_log` (I9). Mirrors the DB CHECK. */
export const ADMIN_ACTIONS = [
  'extend_trial',
  'give_free_months',
  'change_plan',
  'pause_booking_page',
  'resume_booking_page',
  'suspend_business',
  'unsuspend_business',
  'change_owner',
  'resend_link',
  'export_data',
  'close_account',
  'send_deletion_notice',
  'hold_deletion',
  'release_deletion',
  'delete_business_data',
  'record_payment',
  'record_refund',
  'recheck_payment',
  'retry_job',
  'update_plans',
  'update_platform_settings',
  'add_admin',
  'change_admin_role',
  'remove_admin',
  'reset_two_factor',
  'send_announcement',
  'privacy_request_update',
  'support_case_update',
  'note',
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/** I10: support handles day-to-day work; super_admin also manages admins, plans and settings. */
export const ADMIN_ROLES = ['support', 'super_admin'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** I1 filter chips. "pilot" = on a trial that FTech extended. */
export const ADMIN_BUSINESS_FILTERS = ['all', 'trial', 'paying', 'ended', 'pilot'] as const;
export type AdminBusinessFilter = (typeof ADMIN_BUSINESS_FILTERS)[number];

/** Status shown in the I1 table and the I2 header. */
export type AdminPlanState = 'trial' | 'pilot' | 'paying' | 'ended';

/** No access → ended; trialing → trial (pilot once extended by FTech); otherwise paying. */
export function adminPlanState(sub: PlanAccessInput | null, trialExtended: boolean, now: Date = new Date()): AdminPlanState {
  if (!sub || !hasPlanAccess(sub, now)) return 'ended';
  if (sub.status === 'trialing') return trialExtended ? 'pilot' : 'trial';
  return 'paying';
}

/** Every admin change needs a reason; it is saved in the audit log. */
export const adminReason = z.string().trim().min(3, 'Add a reason (at least 3 characters)').max(500);

export const adminBusinessQuery = z.object({
  q: z.string().trim().max(100).optional(),
  filter: z.enum(ADMIN_BUSINESS_FILTERS).default('all'),
});
export type AdminBusinessQuery = z.infer<typeof adminBusinessQuery>;

/** I2 "Extend free trial": +7 / +14 / +30 days, or "Pick date" (last day of the trial, Malaysia time). */
export const extendTrialSchema = z
  .object({
    days: z.number().int().min(1).max(365).optional(),
    until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
      .optional(),
    reason: adminReason,
  })
  .refine((v) => (v.days === undefined) !== (v.until === undefined), { message: 'Give either days or a date', path: ['days'] });
export type ExtendTrialInput = z.infer<typeof extendTrialSchema>;

/** I2 "Booking page live" switch. */
export const bookingPageSchema = z.object({ enabled: z.boolean(), reason: adminReason });
export type BookingPageInput = z.infer<typeof bookingPageSchema>;

export const adminNoteSchema = z.object({ reason: adminReason });
export type AdminNoteInput = z.infer<typeof adminNoteSchema>;

export const auditLogQuery = z.object({
  businessId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditLogQuery = z.infer<typeof auditLogQuery>;

export interface AdminMe {
  userId: number;
  name: string;
  email: string;
}

export interface AdminSubscription {
  plan: string;
  status: SubscriptionStatus;
  trialEndsAt: string;
  currentPeriodEnd: string | null;
  hasAccess: boolean;
}

export interface AdminBusinessRow {
  id: number;
  name: string;
  slug: string;
  template: BusinessTemplate;
  ownerName: string | null;
  phone: string | null;
  state: AdminPlanState;
  subscription: AdminSubscription | null;
  bookingEnabled: boolean;
  /** Bookings made in the last 30 days (any status). */
  bookings30d: number;
  createdAt: string;
}

export interface AdminKpis {
  businesses: number;
  onTrial: number;
  /** On trial (or pilot) and the trial ends within 7 days. */
  trialEndingThisWeek: number;
  paying: number;
  trialEnded: number;
  /** Plan payments received by FTech in the last 30 days. */
  revenue30dSen: number;
}

export interface AdminBusinessesResponse {
  kpis: AdminKpis;
  businesses: AdminBusinessRow[];
}

export interface AuditEntry {
  id: number;
  action: AdminAction;
  reason: string;
  details: Record<string, string | number | boolean | null>;
  admin: { id: number; name: string };
  business: { id: number; name: string } | null;
  createdAt: string;
}

export interface AdminBusinessDetail extends AdminBusinessRow {
  owner: { name: string; email: string; phone: string | null } | null;
  whatsappPhone: string | null;
  resourceLabel: string;
  resourceCount: number;
  /** Active staff, not counting the owner. */
  staffCount: number;
  /** Only whether it is connected — never the key. */
  toyyibpayConnected: boolean;
  auditLog: AuditEntry[];
}
