import { and, count, eq, isNull } from 'drizzle-orm';
import { businesses, businessMembers, resources, subscriptions, type Db } from '@outletbooking/db';
import {
  hasPlanAccess,
  PAID_PLANS,
  recommendedPlan,
  type PaidPlan,
  type PlanInfo,
  type SubscriptionStatus,
} from '@outletbooking/shared';
import { notFound } from '../errors';

/** I4 plan payment page on the website. The business is identified by its slug, never the integer id. */
export const planPayUrl = (websiteUrl: string, slug: string, plan: PaidPlan) => {
  const url = new URL('/billing', websiteUrl);
  url.searchParams.set('business', slug);
  url.searchParams.set('plan', plan);
  return url.toString();
};

/** E3 choose a plan / E4 trial ended: current plan, what the business uses, where to pay. */
export async function getPlanInfo(db: Db, businessId: number, websiteUrl: string, now = new Date()): Promise<PlanInfo> {
  const [[row], [res], [staff]] = await Promise.all([
    db
      .select({
        slug: businesses.slug,
        plan: subscriptions.plan,
        status: subscriptions.status,
        trialEndsAt: subscriptions.trialEndsAt,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      })
      .from(businesses)
      .leftJoin(subscriptions, eq(subscriptions.businessId, businesses.id))
      .where(eq(businesses.id, businessId)),
    db
      .select({ n: count() })
      .from(resources)
      .where(and(eq(resources.businessId, businessId), isNull(resources.deletedAt), eq(resources.isActive, true))),
    db
      .select({ n: count() })
      .from(businessMembers)
      .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.role, 'staff'), eq(businessMembers.isActive, true))),
  ]);
  if (!row) throw notFound('Business');

  const status = (row.status ?? 'expired') as SubscriptionStatus;
  const trialEndsAt = row.trialEndsAt ?? now;
  const resourceCount = res?.n ?? 0;
  const staffCount = staff?.n ?? 0;
  return {
    plan: (row.plan ?? 'trial') as PlanInfo['plan'],
    status,
    trialEndsAt: trialEndsAt.toISOString(),
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    hasAccess: hasPlanAccess({ status, trialEndsAt, currentPeriodEnd: row.currentPeriodEnd }, now),
    resourceCount,
    staffCount,
    recommended: recommendedPlan(resourceCount, staffCount),
    payUrls: Object.fromEntries(PAID_PLANS.map((p) => [p, planPayUrl(websiteUrl, row.slug, p)])) as Record<PaidPlan, string>,
  };
}
