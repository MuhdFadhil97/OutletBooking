import { DEFAULT_PLANS, DEFAULT_TRIAL_DAYS, publicPlansSchema, type PublicPlans } from '@outletbooking/shared';
import { API_URL } from './config';

/** What the pricing section shows when the API cannot be reached (same numbers the database is seeded with). */
export const FALLBACK_PLANS: PublicPlans = { plans: DEFAULT_PLANS, trialDays: DEFAULT_TRIAL_DAYS };

/**
 * I12 → website: plans, prices and limits from GET /plans (no login), cached for a minute so a price change
 * shows up quickly without a redeploy. Anything unexpected (API down, not live yet, odd answer) falls back to
 * the built-in plans, so the marketing site never breaks.
 */
export async function getPublicPlans(): Promise<PublicPlans> {
  if (!API_URL) return FALLBACK_PLANS;
  try {
    const res = await fetch(`${API_URL}/plans`, { next: { revalidate: 60 } });
    if (!res.ok) return FALLBACK_PLANS;
    const parsed = publicPlansSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : FALLBACK_PLANS;
  } catch {
    return FALLBACK_PLANS;
  }
}
