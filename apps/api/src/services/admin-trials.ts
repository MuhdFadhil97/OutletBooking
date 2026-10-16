import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { formatInTimeZone } from 'date-fns-tz';
import {
  adminAuditLog,
  bookings,
  businesses,
  businessMembers,
  paymentAccounts,
  payments,
  resources,
  services,
  sessions,
  subscriptions,
  users,
  workingHours,
  type Db,
} from '@outletbooking/db';
import {
  SETUP_STEPS,
  TRIAL_CONVERSION_DAYS,
  TRIAL_ENDED_LOOKBACK_DAYS,
  TRIAL_SOON_DAYS,
  TRIAL_WEEK_DAYS,
  type BusinessTemplate,
  type TrialKpis,
  type TrialRow,
  type TrialsQuery,
  type TrialsResponse,
} from '@outletbooking/shared';
import { LINK_SHARED_KEY } from './checklist';

const DAY_MS = 24 * 60 * 60 * 1000;
const TZ = 'Asia/Kuala_Lumpur';

/** Whole Malaysia calendar days from `now` until `at` (0 = today, negative = past). */
export function malaysiaDaysUntil(at: Date, now: Date): number {
  const day = (d: Date) => Date.parse(`${formatInTimeZone(d, TZ, 'yyyy-MM-dd')}T00:00:00Z`);
  return Math.round((day(at) - day(now)) / DAY_MS);
}

const b = businesses;

/** First active owner of the business. */
const ownerUserId = sql<number | null>`(select ${businessMembers.userId} from ${businessMembers}
  where ${businessMembers.businessId} = ${b.id} and ${businessMembers.role} = 'owner' and ${businessMembers.isActive}
  order by ${businessMembers.id} limit 1)`;

/**
 * D8 steps done, the same rules as services/checklist.ts but for many businesses in one query:
 * account (always) · an active resource with working hours · ToyyibPay connected · link shared · any booking.
 */
const setupDone = sql<number>`(1
  + (exists(select 1 from ${resources} r where r.business_id = ${b.id} and r.is_active and r.deleted_at is null
      and exists(select 1 from ${workingHours} w where w.business_id = ${b.id} and w.resource_id = r.id)))::int
  + (exists(select 1 from ${paymentAccounts} pa where pa.business_id = ${b.id} and pa.status = 'connected'))::int
  + (${b.settings} ? ${LINK_SHARED_KEY})::int
  + (exists(select 1 from ${bookings} bk where bk.business_id = ${b.id}))::int)`;

/** I7 · Businesses on a trial that was never paid for: ending soon, ended recently, or never set up. */
export async function listTrials(db: Db, query: TrialsQuery, now: Date = new Date()): Promise<TrialsResponse> {
  const endedSince = new Date(now.getTime() - TRIAL_ENDED_LOOKBACK_DAYS * DAY_MS);
  const rows = await db
    .select({
      id: b.id,
      name: b.name,
      slug: b.slug,
      template: b.template,
      phone: b.phone,
      whatsappPhone: b.whatsappPhone,
      bookingEnabled: b.bookingEnabled,
      ownerName: users.name,
      ownerPhone: users.phone,
      trialEndsAt: subscriptions.trialEndsAt,
      setupDone,
      bookingsInTrial: sql<number>`(select count(*)::int from ${bookings}
        where ${bookings.businessId} = ${b.id} and ${bookings.createdAt} <= ${subscriptions.trialEndsAt})`,
      connected: sql<boolean>`exists(select 1 from ${paymentAccounts}
        where ${paymentAccounts.businessId} = ${b.id} and ${paymentAccounts.status} = 'connected')`,
      takesPayments: sql<boolean>`exists(select 1 from ${services}
        where ${services.businessId} = ${b.id} and ${services.deletedAt} is null
        and (${services.depositSen} > 0 or ${services.prepayFull}))`,
      extended: sql<boolean>`exists(select 1 from ${adminAuditLog}
        where ${adminAuditLog.businessId} = ${b.id} and ${adminAuditLog.action} = 'extend_trial')`,
      lastActiveAt: sql<Date | null>`(select max(${sessions.updatedAt}) from ${sessions}
        join ${businessMembers} m on m.user_id = ${sessions.userId}
        where m.business_id = ${b.id} and m.is_active)`,
    })
    .from(b)
    .innerJoin(subscriptions, eq(subscriptions.businessId, b.id))
    .leftJoin(users, eq(users.id, ownerUserId))
    .where(
      and(
        isNull(b.deletedAt),
        // A trial never paid for: still trialing (maybe past its end) or expired by the job.
        inArray(subscriptions.status, ['trialing', 'expired']),
        isNull(subscriptions.currentPeriodEnd),
        gte(subscriptions.trialEndsAt, endedSince),
      ),
    )
    .orderBy(subscriptions.trialEndsAt, b.id);

  const all: TrialRow[] = rows.map((r) => {
    const daysLeft = malaysiaDaysUntil(r.trialEndsAt, now);
    return {
      id: r.id,
      name: r.name,
      template: r.template as BusinessTemplate,
      ownerName: r.ownerName,
      phone: r.whatsappPhone ?? r.phone ?? r.ownerPhone ?? null,
      trialEndsAt: r.trialEndsAt.toISOString(),
      daysLeft,
      ended: r.trialEndsAt.getTime() <= now.getTime(),
      extended: r.extended,
      bookingEnabled: r.bookingEnabled,
      setupDone: Number(r.setupDone),
      setupTotal: SETUP_STEPS.length,
      bookingsInTrial: Number(r.bookingsInTrial),
      payments: r.connected ? 'connected' : r.takesPayments ? 'not_yet' : 'not_needed',
      lastActiveAt: r.lastActiveAt ? new Date(r.lastActiveAt).toISOString() : null,
    };
  });

  const onTrialWithin = (t: TrialRow, days: number) => !t.ended && t.daysLeft <= days;
  const kpis: TrialKpis = {
    endsSoon: all.filter((t) => onTrialWithin(t, 1)).length,
    endThisWeek: all.filter((t) => onTrialWithin(t, TRIAL_WEEK_DAYS)).length,
    endedNotPaid: all.filter((t) => t.ended).length,
    conversion: await trialConversion(db, now),
  };

  const needle = query.q?.toLowerCase();
  const digits = query.q?.replace(/\D/g, '') ?? '';
  const raw = new Map(rows.map((r) => [r.id, r]));
  const trials = all.filter((t) => {
    if (needle) {
      const r = raw.get(t.id)!;
      const phones = [r.phone, r.whatsappPhone, r.ownerPhone].filter((p): p is string => !!p).map((p) => p.replace(/\D/g, ''));
      const byText = t.name.toLowerCase().includes(needle) || r.slug.toLowerCase().includes(needle);
      // "0123456789" also finds +60123456789.
      const byPhone = digits.length >= 4 && phones.some((p) => p.includes(digits.replace(/^0/, '')));
      if (!byText && !byPhone) return false;
    }
    switch (query.filter) {
      case 'soon':
        return onTrialWithin(t, TRIAL_SOON_DAYS);
      case 'week':
        return onTrialWithin(t, TRIAL_WEEK_DAYS);
      case 'ended':
        return t.ended;
      case 'never':
        return t.setupDone <= 1;
    }
  });
  // Ended trials: most recently ended first; open trials: soonest end first.
  if (query.filter === 'ended') trials.reverse();
  return { kpis, trials };
}

/** "Trial → paid (90 days)": of the trials that ended in the last 90 days, how many paid for a plan. */
async function trialConversion(db: Db, now: Date): Promise<TrialKpis['conversion']> {
  const since = new Date(now.getTime() - TRIAL_CONVERSION_DAYS * DAY_MS);
  const [row] = await db
    .select({
      ended: sql<number>`count(*)::int`,
      paid: sql<number>`count(*) filter (where exists(select 1 from ${payments}
        where ${payments.businessId} = ${subscriptions.businessId}
        and ${payments.purpose} = 'subscription' and ${payments.status} = 'paid'))::int`,
    })
    .from(subscriptions)
    .innerJoin(b, eq(b.id, subscriptions.businessId))
    .where(and(isNull(b.deletedAt), gte(subscriptions.trialEndsAt, since), lte(subscriptions.trialEndsAt, now)));
  const ended = Number(row?.ended ?? 0);
  return ended ? { ended, paid: Number(row?.paid ?? 0) } : null;
}
