import { eq } from 'drizzle-orm';
import { businesses, subscriptions, users, type Db } from '@outletbooking/db';
import type { BusinessTemplate, MeResponse, SubscriptionStatus } from '@outletbooking/shared';
import { notFound } from '../errors';
import type { Tenant } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left, rounded up (6.2 days → 7). 0 once the trial has ended. */
export function trialDaysLeft(trialEndsAt: Date, now: Date = new Date()): number {
  const ms = trialEndsAt.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
}

export async function getMe(db: Db, userId: number, tenant: Tenant, now: Date = new Date()): Promise<MeResponse> {
  const [row] = await db
    .select({
      user: { id: users.id, name: users.name, email: users.email, phone: users.phone },
      business: {
        slug: businesses.slug,
        name: businesses.name,
        template: businesses.template,
        resourceLabel: businesses.resourceLabel,
        timezone: businesses.timezone,
      },
      sub: {
        plan: subscriptions.plan,
        status: subscriptions.status,
        trialEndsAt: subscriptions.trialEndsAt,
      },
    })
    .from(users)
    .innerJoin(businesses, eq(businesses.id, tenant.businessId))
    .leftJoin(subscriptions, eq(subscriptions.businessId, businesses.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) throw notFound('Account');

  const trialEndsAt = row.sub?.trialEndsAt ?? now;
  const status = (row.sub?.status ?? 'expired') as SubscriptionStatus;
  const daysLeft = trialDaysLeft(trialEndsAt, now);

  return {
    user: row.user,
    business: { ...row.business, template: row.business.template as BusinessTemplate },
    role: tenant.role,
    subscription: {
      plan: (row.sub?.plan ?? 'trial') as MeResponse['subscription']['plan'],
      status,
      trialEndsAt: trialEndsAt.toISOString(),
      trialDaysLeft: daysLeft,
      isTrialActive: status === 'trialing' && daysLeft > 0,
    },
  };
}
