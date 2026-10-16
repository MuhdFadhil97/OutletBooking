import { z } from 'zod';
import type { SubscriptionStatus } from './types';

/**
 * E3 choose a plan · E4 trial ended · F3 booking page paused (FR-16, PRD section 12).
 * Plans are paid on the website (Phase 7 I4), never in the app.
 */

export const PAID_PLANS = ['starter', 'business'] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

export const PLAN_PRICES: Record<PaidPlan, { priceSen: number; resourceLimit: number }> = {
  starter: { priceSen: 4900, resourceLimit: 3 },
  business: { priceSen: 9900, resourceLimit: 10 },
};
/** Each resource above the plan limit. */
export const EXTRA_RESOURCE_SEN = 1000;

export interface PlanAccessInput {
  status: SubscriptionStatus | string;
  trialEndsAt: Date | string;
  /** End of the paid period; null = no end set (e.g. switched on by FTech). */
  currentPeriodEnd: Date | string | null;
}

/**
 * Can the business take bookings and make changes? (FR-16.3)
 * Trial: until trial_ends_at. Paid (active / past_due / cancelled): until current_period_end.
 * Expired, or no subscription at all: no — the booking page is paused and the app is view only.
 */
export function hasPlanAccess(sub: PlanAccessInput | null | undefined, now: Date = new Date()): boolean {
  if (!sub) return false;
  const until = (d: Date | string) => new Date(d).getTime() > now.getTime();
  switch (sub.status) {
    case 'trialing':
      return until(sub.trialEndsAt);
    case 'active':
      return sub.currentPeriodEnd === null || until(sub.currentPeriodEnd);
    case 'past_due':
    case 'cancelled':
      return sub.currentPeriodEnd !== null && until(sub.currentPeriodEnd);
    default:
      return false;
  }
}

/**
 * "Best for you": Business when the business needs more than Starter's resources or has staff (staff app).
 * `starterLimit` is Starter's current resource limit from I12 (defaults to the built-in one).
 */
export function recommendedPlan(
  resourceCount: number,
  staffCount: number,
  starterLimit: number = PLAN_PRICES.starter.resourceLimit,
): PaidPlan {
  return resourceCount > starterLimit || staffCount > 0 ? 'business' : 'starter';
}

/** Monthly price with resources above the limit (built-in prices; see `planEntryMonthlySen` for I12 prices). */
export const planMonthlySen = (plan: PaidPlan, resourceCount: number) =>
  PLAN_PRICES[plan].priceSen + Math.max(0, resourceCount - PLAN_PRICES[plan].resourceLimit) * EXTRA_RESOURCE_SEN;

// ------------------------------------------------------------ I12 plan catalog (prices editable by super admins)

/** Features shown per plan on the website and in E3. Stored as flags; not enforced anywhere yet. */
export const PLAN_FEATURES = ['online_payment', 'staff_app', 'reports'] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];
export type PlanFeatures = Record<PlanFeature, boolean>;

/** One plan as the website, the app and I12 see it. Prices are per month, integer sen. */
export interface PlanCatalogEntry {
  code: PaidPlan;
  name: string;
  priceSen: number;
  resourceLimit: number;
  /** Each resource above `resourceLimit`, per month. */
  extraResourceSen: number;
  features: PlanFeatures;
  /** Shown on the website (I3, I4). Always true for at least one plan. */
  isPublic: boolean;
}

/** I12 "Trial & renewal". Only `trialDays` is used today; grace and reminders come with plan renewals. */
export interface PlanSettings {
  trialDays: number;
  graceDays: number;
  /** Days before the plan ends, e.g. [7, 3, 1]. */
  renewalReminderDays: number[];
}

export const DEFAULT_TRIAL_DAYS = 7;
export const DEFAULT_GRACE_DAYS = 3;
export const DEFAULT_RENEWAL_REMINDER_DAYS = [7, 3, 1];

const DEFAULT_FEATURES: Record<PaidPlan, PlanFeatures> = {
  starter: { online_payment: true, staff_app: false, reports: false },
  business: { online_payment: true, staff_app: true, reports: true },
};
const DEFAULT_NAMES: Record<PaidPlan, string> = { starter: 'Starter', business: 'Business' };

/** The built-in plans (what the database is seeded with); used when the API cannot be reached. */
export const DEFAULT_PLANS: PlanCatalogEntry[] = PAID_PLANS.map((code) => ({
  code,
  name: DEFAULT_NAMES[code],
  priceSen: PLAN_PRICES[code].priceSen,
  resourceLimit: PLAN_PRICES[code].resourceLimit,
  extraResourceSen: EXTRA_RESOURCE_SEN,
  features: { ...DEFAULT_FEATURES[code] },
  isPublic: true,
}));

export const DEFAULT_PLAN_SETTINGS: PlanSettings = {
  trialDays: DEFAULT_TRIAL_DAYS,
  graceDays: DEFAULT_GRACE_DAYS,
  renewalReminderDays: DEFAULT_RENEWAL_REMINDER_DAYS,
};

/** Monthly price of a catalog plan with the resources above its limit. */
export const planEntryMonthlySen = (
  plan: Pick<PlanCatalogEntry, 'priceSen' | 'resourceLimit' | 'extraResourceSen'>,
  resourceCount: number,
) => plan.priceSen + Math.max(0, resourceCount - plan.resourceLimit) * plan.extraResourceSen;

/** GET /plans (no login): what the website pricing and the app's E3 show. */
export interface PublicPlans {
  /** Plans shown on the website, in display order. */
  plans: PlanCatalogEntry[];
  trialDays: number;
}

/** Runtime check for the website, which must never break when the API answers something unexpected. */
export const publicPlansSchema = z.object({
  plans: z
    .array(
      z.object({
        code: z.enum(PAID_PLANS),
        name: z.string().min(1),
        priceSen: z.number().int().positive(),
        resourceLimit: z.number().int().positive(),
        extraResourceSen: z.number().int().nonnegative(),
        features: z.object({ online_payment: z.boolean(), staff_app: z.boolean(), reports: z.boolean() }),
        isPublic: z.boolean(),
      }),
    )
    .min(1),
  trialDays: z.number().int().positive(),
});

/** GET /businesses/current/plan (owner). */
export interface PlanInfo {
  plan: 'trial' | PaidPlan;
  status: SubscriptionStatus;
  trialEndsAt: string;
  currentPeriodEnd: string | null;
  /** Free months given by FTech (I2) run until here: "Free until 16 Dec". */
  freeUntil: string | null;
  hasAccess: boolean;
  /** Active resources and active staff (not counting the owner). */
  resourceCount: number;
  staffCount: number;
  recommended: PaidPlan;
  /** Current prices and limits (I12), for the plan cards. */
  plans: PlanCatalogEntry[];
  /** Website payment page per plan (I4). */
  payUrls: Record<PaidPlan, string>;
}
