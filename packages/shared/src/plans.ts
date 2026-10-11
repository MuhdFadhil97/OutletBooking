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

/** "Best for you": Business when the business needs more than Starter's resources or has staff (staff app). */
export function recommendedPlan(resourceCount: number, staffCount: number): PaidPlan {
  return resourceCount > PLAN_PRICES.starter.resourceLimit || staffCount > 0 ? 'business' : 'starter';
}

/** Monthly price with resources above the limit. */
export const planMonthlySen = (plan: PaidPlan, resourceCount: number) =>
  PLAN_PRICES[plan].priceSen + Math.max(0, resourceCount - PLAN_PRICES[plan].resourceLimit) * EXTRA_RESOURCE_SEN;

/** GET /businesses/current/plan (owner). */
export interface PlanInfo {
  plan: 'trial' | PaidPlan;
  status: SubscriptionStatus;
  trialEndsAt: string;
  currentPeriodEnd: string | null;
  hasAccess: boolean;
  /** Active resources and active staff (not counting the owner). */
  resourceCount: number;
  staffCount: number;
  recommended: PaidPlan;
  /** Website payment page per plan (I4). */
  payUrls: Record<PaidPlan, string>;
}
