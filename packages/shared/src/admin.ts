import { z } from 'zod';
import { emailSchema, passwordSchema } from './schemas';
import {
  hasPlanAccess,
  PAID_PLANS,
  type PaidPlan,
  type PlanAccessInput,
  type PlanCatalogEntry,
  type PlanSettings,
} from './plans';
import type { MemberRole, SubscriptionStatus } from './types';
import type { BusinessTemplate } from './templates';

/**
 * I1 / I2 platform admin (FTech only, desktop web in apps/web).
 * Admins never see ToyyibPay keys or customers' payment details — only "connected" and counts.
 */

/** Every admin change writes one of these to `admin_audit_log` (I9). Mirrors the DB CHECK. */
export const ADMIN_ACTIONS = [
  'sign_in',
  'sign_in_failed',
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
  // I29 my account: an admin's own security changes
  'change_password',
  'new_backup_codes',
  'move_two_factor',
  'sign_out_devices',
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/** I10: support handles day-to-day work; super_admin also manages admins, plans and settings. */
export const ADMIN_ROLES = ['support', 'super_admin'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** I5 / I6: wrong passwords or two-step codes in a row before the admin login is locked, and for how long. */
export const ADMIN_MAX_SIGN_IN_FAILURES = 5;
export const ADMIN_LOCK_MINUTES = 15;

/** Error codes the admin sign-in screens react to. */
export const ADMIN_AUTH_ERRORS = {
  /** Signed in with a password, but two-step sign-in is not set up yet (first sign-in, I6). */
  twoFactorSetupRequired: 'two_factor_setup_required',
  /** Too many wrong passwords (I5). */
  accountLocked: 'account_locked',
} as const;

/** I1 filter chips. "pilot" = on a trial that FTech extended. */
export const ADMIN_BUSINESS_FILTERS = ['all', 'trial', 'paying', 'ended', 'pilot'] as const;
export type AdminBusinessFilter = (typeof ADMIN_BUSINESS_FILTERS)[number];

/** Status shown in the I1 table and the I2 header. */
export type AdminPlanState = 'trial' | 'pilot' | 'paying' | 'ended';

/** No access → ended; trialing → trial (pilot once extended by FTech); otherwise paying. */
export function adminPlanState(
  sub: PlanAccessInput | null,
  trialExtended: boolean,
  now: Date = new Date(),
  graceDays = 0,
): AdminPlanState {
  if (!sub || !hasPlanAccess(sub, now, graceDays)) return 'ended';
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

/**
 * I2 "Give free months": the paid period is extended with no payment (`current_period_end` and
 * `free_until` move together, so renewal, grace and reminders work as usual). A business on a trial or
 * whose plan ended starts the given plan today (default Business); a paying business keeps its plan.
 */
export const FREE_MONTH_OPTIONS = [1, 2, 3] as const;
export const freeMonthsSchema = z.object({
  months: z.number().int().min(1).max(12),
  plan: z.enum(PAID_PLANS).optional(),
  reason: adminReason,
});
export type FreeMonthsInput = z.infer<typeof freeMonthsSchema>;

/** I2 "Change plan" by hand, for a paying business (dates stay the same; resource limit follows the plan). */
export const changePlanSchema = z.object({ plan: z.enum(PAID_PLANS), reason: adminReason });
export type ChangePlanInput = z.infer<typeof changePlanSchema>;

/** I2 "Send password reset link" to the owner (same email as E1 forgot password). */
export const ownerLinkSchema = z.object({ reason: adminReason });
export type OwnerLinkInput = z.infer<typeof ownerLinkSchema>;

/**
 * I2 "Suspend business" for misuse: the owner and staff app and the booking page are locked, and the owner
 * sees the reason. The admin types the business name again to confirm.
 */
export const suspendSchema = z.object({
  reason: adminReason,
  confirmName: z.string().trim().min(1, 'Type the business name to confirm').max(200),
});
export type SuspendInput = z.infer<typeof suspendSchema>;

export const unsuspendSchema = z.object({ reason: adminReason });
export type UnsuspendInput = z.infer<typeof unsuspendSchema>;

/** I2 "Change owner": what happens to the old owner. */
export const OLD_OWNER_OPTIONS = ['staff', 'remove'] as const;
export type OldOwnerOption = (typeof OLD_OWNER_OPTIONS)[number];

/**
 * I2 "Change owner": an active staff member becomes the owner. Needs proof from the business
 * (e.g. "SSM certificate + letter emailed 3 Oct") and a reason. The old owner becomes staff or is removed.
 */
export const changeOwnerSchema = z.object({
  newOwnerUserId: z.number().int().positive(),
  oldOwner: z.enum(OLD_OWNER_OPTIONS),
  proof: z.string().trim().min(3, 'Describe the proof from the business (SSM, letter…)').max(500),
  reason: adminReason,
});
export type ChangeOwnerInput = z.infer<typeof changeOwnerSchema>;

/** I2 admin note on a business: free text only admins see. Kept in `admin_business_notes` (deleted with the business), never in the audit log. */
export const adminNoteSchema = z.object({ body: z.string().trim().min(2, 'Write a note first').max(2000) });
export type AdminNoteInput = z.infer<typeof adminNoteSchema>;

export interface AdminNote {
  id: number;
  body: string;
  /** null = a removed admin. */
  admin: { id: number; name: string } | null;
  createdAt: string;
}

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** I9 filters (all optional, combined with AND). Dates are Malaysia calendar days, both ends included. */
const auditLogFilterFields = z.object({
  businessId: z.coerce.number().int().positive().optional(),
  adminId: z.coerce.number().int().positive().optional(),
  action: z.enum(ADMIN_ACTIONS).optional(),
  /** Business name or link, partial match. */
  business: z.string().trim().min(1).max(100).optional(),
  from: ymd.optional(),
  to: ymd.optional(),
});
const datesInOrder = (v: { from?: string; to?: string }) => !v.from || !v.to || v.from <= v.to;
const datesMessage = { message: 'The start date is after the end date', path: ['from'] };

export const auditLogFilters = auditLogFilterFields.refine(datesInOrder, datesMessage);
export type AuditLogFilters = z.infer<typeof auditLogFilters>;

export const auditLogQuery = auditLogFilterFields
  .extend({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    /** "Load more": entries older than this entry id (ids grow with time). */
    beforeId: z.coerce.number().int().positive().optional(),
  })
  .refine(datesInOrder, datesMessage);
export type AuditLogQuery = z.infer<typeof auditLogQuery>;

export interface AdminMe {
  userId: number;
  name: string;
  email: string;
  role: AdminRole;
}

/** I9 "Admin" filter (and later I10): everyone who is or was a platform admin. */
export interface AdminUserOption {
  userId: number;
  name: string;
  role: AdminRole;
  isActive: boolean;
}

/** Most audit rows the I9 CSV export holds. */
export const AUDIT_EXPORT_MAX_ROWS = 10_000;

export interface AdminSubscription {
  plan: string;
  status: SubscriptionStatus;
  trialEndsAt: string;
  currentPeriodEnd: string | null;
  /** Free months given by FTech run until here (no payment). */
  freeUntil: string | null;
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
  /** Suspended for misuse by FTech (app and booking page locked). */
  suspended: { at: string; reason: string } | null;
  /** The owner asked to close (I2 / I26): the booking page is closed and the data is deleted on `deleteOn`. */
  closing: { requestedAt: string; deleteOn: string | null } | null;
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
  /** null = the system itself (the daily data-deletion job). */
  admin: { id: number; name: string } | null;
  business: { id: number; name: string } | null;
  createdAt: string;
}

export interface AdminMember {
  userId: number;
  name: string;
  email: string;
  role: MemberRole;
  emailVerified: boolean;
  isActive: boolean;
  canViewAll: boolean;
  canTakePayments: boolean;
  canEditSetup: boolean;
  joinedAt: string;
}

export interface AdminInvitation {
  email: string;
  expiresAt: string;
  expired: boolean;
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
  /** Owner first, then staff; inactive members last. */
  members: AdminMember[];
  /** Staff invitations not accepted yet (expired ones included, marked). */
  invitations: AdminInvitation[];
  /** Admin-only notes, newest first. */
  notes: AdminNote[];
  auditLog: AuditEntry[];
}

// ------------------------------------------------------------ I7 trials ending

/** I7 chips. "soon" = ends within 3 days; "week" (default) = within 7; "ended" = ended in the last 30 days, never paid. */
export const TRIAL_FILTERS = ['soon', 'week', 'ended', 'never'] as const;
export type TrialFilter = (typeof TRIAL_FILTERS)[number];
/** I7: days before the trial end that count as "soon" / "this week", and how far back "ended, not paid" looks. */
export const TRIAL_SOON_DAYS = 3;
export const TRIAL_WEEK_DAYS = 7;
export const TRIAL_ENDED_LOOKBACK_DAYS = 30;
/** I7 KPI "Trial → paid": trials that ended in this many days. */
export const TRIAL_CONVERSION_DAYS = 90;

export const trialsQuery = z.object({
  /** Business name, link or phone. */
  q: z.string().trim().max(100).optional(),
  filter: z.enum(TRIAL_FILTERS).default('week'),
});
export type TrialsQuery = z.infer<typeof trialsQuery>;

/** connected = own ToyyibPay connected (H1); not_needed = no service takes a deposit or full payment. */
export type TrialPaymentState = 'connected' | 'not_yet' | 'not_needed';

export interface TrialRow {
  id: number;
  name: string;
  template: BusinessTemplate;
  ownerName: string | null;
  /** WhatsApp number, else business phone, else owner's mobile (E.164). */
  phone: string | null;
  trialEndsAt: string;
  /** Malaysia calendar days until the trial end (0 = today, negative = ended). */
  daysLeft: number;
  ended: boolean;
  /** FTech extended this trial before (pilot). */
  extended: boolean;
  bookingEnabled: boolean;
  /** D8 setup steps done (account counts as done). */
  setupDone: number;
  setupTotal: number;
  /** Bookings made up to the trial end (any status). */
  bookingsInTrial: number;
  payments: TrialPaymentState;
  /** Last time the owner or staff used the app (session refreshed), null if never / signed out. */
  lastActiveAt: string | null;
}

export interface TrialKpis {
  /** Still on trial; ends today or tomorrow. */
  endsSoon: number;
  endThisWeek: number;
  endedNotPaid: number;
  /** Trials that ended in the last 90 days and paid for a plan; null when none ended. */
  conversion: { paid: number; ended: number } | null;
}

export interface TrialsResponse {
  kpis: TrialKpis;
  trials: TrialRow[];
}

// ------------------------------------------------------------ I10 admin users (super admin only)

/** I10: how long an admin invite link works. */
export const ADMIN_INVITE_DAYS = 7;

/** active = can sign in; invited = has not set a password yet; removed = no access (kept for the audit log). */
export type AdminUserStatus = 'active' | 'invited' | 'removed';

export interface AdminUserRow {
  userId: number;
  name: string;
  email: string;
  role: AdminRole;
  status: AdminUserStatus;
  twoFactorEnabled: boolean;
  /** Latest successful sign-in (from the audit log), null if never. */
  lastSignInAt: string | null;
  /** Invited: when the current link stops working (null = no link, e.g. expired and cleaned up). */
  inviteExpiresAt: string | null;
}

export const inviteAdminSchema = z.object({
  email: emailSchema,
  role: z.enum(ADMIN_ROLES),
  reason: adminReason,
});
export type InviteAdminInput = z.infer<typeof inviteAdminSchema>;

export const changeAdminRoleSchema = z.object({ role: z.enum(ADMIN_ROLES), reason: adminReason });
export type ChangeAdminRoleInput = z.infer<typeof changeAdminRoleSchema>;

/** Reset two-step, remove, resend or cancel an invite. */
export const adminUserActionSchema = z.object({ reason: adminReason });
export type AdminUserActionInput = z.infer<typeof adminUserActionSchema>;

/** The secret in an admin invite link (/admin/invite/<token>). */
export const adminInviteTokenParam = z.object({ token: z.string().regex(/^[a-f0-9]{48}$/, 'Invalid invite link') });

/** What the invite page shows before the new admin sets a password. */
export interface AdminInviteInfo {
  email: string;
  role: AdminRole;
  invitedBy: string | null;
  expiresAt: string;
}

export const acceptAdminInviteSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(100),
  password: passwordSchema,
});
export type AcceptAdminInviteInput = z.infer<typeof acceptAdminInviteSchema>;

/** Error codes the admin users screens react to. */
export const ADMIN_USER_ERRORS = {
  superAdminOnly: 'super_admin_only',
  /** The email already logs in to a business (owner or staff): admins need a separate login. */
  emailInUse: 'email_in_use',
  alreadyAdmin: 'already_admin',
  notYourself: 'not_yourself',
  lastSuperAdmin: 'last_super_admin',
  inviteExpired: 'invite_expired',
} as const;

// ------------------------------------------------------------ I12 plans & prices (super admin only)

/** Limits of the I12 form. Money is integer sen; the form shows RM. */
export const PLAN_LIMITS = {
  maxPriceSen: 1_000_000,
  maxResourceLimit: 1000,
  maxExtraResourceSen: 100_000,
  maxReminderDays: 5,
} as const;

export const planEditSchema = z.object({
  code: z.enum(PAID_PLANS),
  priceSen: z.number().int().min(100, 'Price must be at least RM 1').max(PLAN_LIMITS.maxPriceSen, 'Price is too high'),
  resourceLimit: z.number().int().min(1, 'At least 1 resource').max(PLAN_LIMITS.maxResourceLimit),
  extraResourceSen: z.number().int().min(0).max(PLAN_LIMITS.maxExtraResourceSen),
  features: z.object({ online_payment: z.boolean(), staff_app: z.boolean(), reports: z.boolean() }),
  isPublic: z.boolean(),
});
export type PlanEditInput = z.infer<typeof planEditSchema>;

export const planSettingsSchema = z.object({
  trialDays: z.number().int().min(1, 'At least 1 day').max(90, 'At most 90 days'),
  graceDays: z.number().int().min(0).max(30, 'At most 30 days'),
  renewalReminderDays: z
    .array(z.number().int().min(1).max(30, 'Reminders are 1 to 30 days before'))
    .max(PLAN_LIMITS.maxReminderDays, `At most ${PLAN_LIMITS.maxReminderDays} reminders`),
});

/** Save I12: both plans and the settings in one go, with a reason. Names are fixed (Starter, Business). */
export const updatePlansSchema = z
  .object({
    plans: z.array(planEditSchema),
    settings: planSettingsSchema,
    reason: adminReason,
  })
  .superRefine((v, ctx) => {
    const codes = v.plans.map((p) => p.code);
    if (codes.length !== PAID_PLANS.length || PAID_PLANS.some((c) => !codes.includes(c))) {
      ctx.addIssue({ code: 'custom', path: ['plans'], message: 'Send both plans: starter and business' });
    }
    if (!v.plans.some((p) => p.isPublic)) {
      ctx.addIssue({ code: 'custom', path: ['plans'], message: 'At least one plan must be shown on the website' });
    }
  });
export type UpdatePlansInput = z.infer<typeof updatePlansSchema>;

/** GET /admin/plans */
export interface AdminPlanCatalog {
  plans: PlanCatalogEntry[];
  settings: PlanSettings;
  /** Businesses on each plan today (they keep their limit until the next renewal or plan change). */
  businessesByPlan: Record<PaidPlan, number>;
}

// ------------------------------------------------------------ I29 my account (every admin, own account only)

/** FR-21.8: admin sessions end after this many hours of no activity. */
export const ADMIN_IDLE_HOURS = 8;
/** Admin passwords are longer than the 8 characters owners need (I29 wireframe). */
export const ADMIN_PASSWORD_MIN_LENGTH = 12;
/** Backup codes Better Auth makes at a time. */
export const ADMIN_BACKUP_CODE_COUNT = 10;
/** How long a "move to a new phone" QR code can be confirmed. */
export const ADMIN_MOVE_PHONE_MINUTES = 10;

export const changeAdminPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(128),
  newPassword: z
    .string()
    .min(ADMIN_PASSWORD_MIN_LENGTH, `At least ${ADMIN_PASSWORD_MIN_LENGTH} characters`)
    .max(128),
});
export type ChangeAdminPasswordInput = z.infer<typeof changeAdminPasswordSchema>;

/** New backup codes / start moving two-step to a new phone: the password is asked again. */
export const adminPasswordConfirmSchema = z.object({ password: z.string().min(1, 'Enter your password').max(128) });
export type AdminPasswordConfirmInput = z.infer<typeof adminPasswordConfirmSchema>;

export const confirmNewPhoneSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });
export type ConfirmNewPhoneInput = z.infer<typeof confirmNewPhoneSchema>;

export interface AdminDevice {
  id: number;
  /** The session making this request. */
  current: boolean;
  /** "Chrome · Windows" (from the browser's user agent). */
  device: string;
  ipAddress: string | null;
  signedInAt: string;
  lastActiveAt: string;
}

/** GET /admin/account */
export interface AdminAccount {
  name: string;
  email: string;
  role: AdminRole;
  twoFactorEnabled: boolean;
  /** Backup codes not used yet, of `backupCodesTotal`. */
  backupCodesLeft: number;
  backupCodesTotal: number;
  devices: AdminDevice[];
}

/** Error codes the My account screens react to. */
export const ADMIN_ACCOUNT_ERRORS = {
  wrongPassword: 'wrong_password',
  /** The 6-digit code from the new phone is wrong (or the setup timed out). */
  wrongCode: 'wrong_code',
  moveExpired: 'move_expired',
  idleExpired: 'session_idle_expired',
} as const;
