import { formatInTimeZone } from 'date-fns-tz';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { businesses, businessMembers, subscriptions, users, type Db } from '@outletbooking/db';
import { graceEnd, PAID_PLANS, type NotificationType } from '@outletbooking/shared';
import type { Env } from '../env';
import { renewalEmail } from './billing-emails';
import type { Mailer } from './mailer';
import { notify } from './notifications';
import { getPlanCatalog } from './plan-catalog';
import type { PushSender } from './push';

const TZ = 'Asia/Kuala_Lumpur';
const DAY_MS = 86_400_000;

export interface RenewalDeps {
  db: Db;
  env: Env;
  mailer: Mailer;
  push: PushSender;
}

/** Stage numbers stored in `subscriptions.renewal_notice_stage`: reminder days (7, 3, 1), then these two. */
export const STAGE_ENDED_IN_GRACE = 0;
export const STAGE_PAUSED = -1;

/** Whole Malaysia calendar days from `now` to `at` (0 = same day, 1 = tomorrow). */
function calendarDaysUntil(at: Date, now: Date): number {
  const day = (d: Date) => Date.parse(`${formatInTimeZone(d, TZ, 'yyyy-MM-dd')}T00:00:00Z`);
  return Math.round((day(at) - day(now)) / DAY_MS);
}

/**
 * Which renewal notice is due for a paid period, ignoring what was already sent:
 * a reminder stage (the smallest I12 reminder day that is ≥ the days left), 0 once the period has ended, -1 once the
 * grace days are over; null = nothing yet (more days left than the first reminder).
 */
export function dueStage(periodEnd: Date, graceDays: number, reminderDays: number[], now: Date): number | null {
  if (now.getTime() >= graceEnd(periodEnd, graceDays).getTime()) return STAGE_PAUSED;
  if (now.getTime() >= periodEnd.getTime()) return STAGE_ENDED_IN_GRACE;
  const left = calendarDaysUntil(periodEnd, now);
  const candidates = reminderDays.filter((n) => n > 0 && n >= left);
  return candidates.length ? Math.min(...candidates) : null;
}

/** Send a notice only when it is more urgent than the last one sent for this same period end (stages only go down). */
export function shouldSend(stage: number | null, sentFor: Date | null, sentStage: number | null, periodEnd: Date): boolean {
  if (stage === null) return false;
  const sameEnd = sentFor !== null && sentFor.getTime() === periodEnd.getTime();
  return !sameEnd || sentStage === null || stage < sentStage;
}

/**
 * Daily job (9:00 Malaysia time) for manual plan renewal (PRD section 15, FR-20.7): reminders N days before a paid
 * period ends (I12 days), "plan ended — the page stays live for the grace days", then "page paused".
 * Each notice goes out once per period: a push + in-app row to the owner and one email. The subscription status
 * follows the clock (active → past_due when the period ends → expired when the grace days are over); access itself is
 * decided by `hasPlanAccess`, so a late job never keeps a page open. Paying again moves the period end, which
 * restarts the notices for the next period.
 */
export async function planRenewals(deps: RenewalDeps, now = new Date()): Promise<{ reminders: number; ended: number; paused: number }> {
  const { db } = deps;
  const { settings, plans: catalog } = await getPlanCatalog(db);
  const website = deps.env.WEBSITE_URL.replace(/\/+$/, '');
  const rows = await db
    .select({
      id: subscriptions.id,
      businessId: subscriptions.businessId,
      businessName: businesses.name,
      plan: subscriptions.plan,
      status: subscriptions.status,
      periodEnd: subscriptions.currentPeriodEnd,
      noticeFor: subscriptions.renewalNoticeFor,
      noticeStage: subscriptions.renewalNoticeStage,
    })
    .from(subscriptions)
    .innerJoin(businesses, and(eq(businesses.id, subscriptions.businessId), isNull(businesses.deletedAt)))
    .where(and(inArray(subscriptions.status, ['active', 'past_due']), isNotNull(subscriptions.currentPeriodEnd)));

  const out = { reminders: 0, ended: 0, paused: 0 };
  for (const row of rows) {
    const periodEnd = row.periodEnd!;
    if (!PAID_PLANS.some((p) => p === row.plan)) continue;
    const stage = dueStage(periodEnd, settings.graceDays, settings.renewalReminderDays, now);

    // Status follows the clock. Guarded by the period end so a payment that just moved it is never overwritten.
    const nextStatus =
      stage === STAGE_PAUSED ? 'expired' : now.getTime() >= periodEnd.getTime() ? 'past_due' : null;
    if (nextStatus && nextStatus !== row.status) {
      await db
        .update(subscriptions)
        .set({ status: nextStatus })
        .where(
          and(eq(subscriptions.id, row.id), eq(subscriptions.currentPeriodEnd, periodEnd), inArray(subscriptions.status, ['active', 'past_due'])),
        );
    }

    if (stage === null || !shouldSend(stage, row.noticeFor, row.noticeStage, periodEnd)) continue;

    // Claim the notice first (compare-and-set), so two runs at once or a retry never send it twice.
    const claimed = await db
      .update(subscriptions)
      .set({ renewalNoticeFor: periodEnd, renewalNoticeStage: stage })
      .where(
        and(
          eq(subscriptions.id, row.id),
          eq(subscriptions.currentPeriodEnd, periodEnd),
          row.noticeFor === null ? isNull(subscriptions.renewalNoticeFor) : eq(subscriptions.renewalNoticeFor, row.noticeFor),
          row.noticeStage === null ? isNull(subscriptions.renewalNoticeStage) : eq(subscriptions.renewalNoticeStage, row.noticeStage),
        ),
      )
      .returning({ id: subscriptions.id });
    if (!claimed.length) continue;

    const planName = catalog.find((p) => p.code === row.plan)?.name ?? 'OutletBooking';
    const endsOn = formatInTimeZone(periodEnd, TZ, 'd MMM yyyy');
    const graceUntil = settings.graceDays > 0 ? formatInTimeZone(graceEnd(periodEnd, settings.graceDays), TZ, 'd MMM yyyy') : null;
    const daysLeft = Math.max(0, calendarDaysUntil(periodEnd, now));
    const kind = stage === STAGE_PAUSED ? 'ended' : stage === STAGE_ENDED_IN_GRACE ? 'grace' : 'due';
    const email = renewalEmail({
      businessName: row.businessName,
      planName,
      stage: kind,
      daysLeft,
      endsOn,
      graceUntil,
      payUrl: `${website}/billing/sign-in`,
      websiteUrl: website,
    });
    const type: NotificationType = kind === 'due' ? 'plan_renewal_due' : kind === 'grace' ? 'plan_grace' : 'plan_ended';
    const when = daysLeft <= 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;
    const owners = await db
      .select({ userId: businessMembers.userId, email: users.email })
      .from(businessMembers)
      .innerJoin(users, eq(users.id, businessMembers.userId))
      .where(and(eq(businessMembers.businessId, row.businessId), eq(businessMembers.role, 'owner'), eq(businessMembers.isActive, true)));

    try {
      await notify(db, deps.push, owners.map((o) => o.userId), {
        businessId: row.businessId,
        type,
        title: kind === 'due' ? `Your plan ends ${when}` : kind === 'grace' ? 'Your plan has ended' : 'Your booking page is paused',
        body:
          kind === 'due'
            ? 'Pay for the next month to keep your booking page open.'
            : kind === 'grace'
              ? `Your booking page stays live until ${graceUntil ?? endsOn}. Pay to keep it open.`
              : 'Choose a plan to switch it back on.',
      });
    } catch (err) {
      console.error('[plan-renewals] push failed for business', row.businessId, err instanceof Error ? err.message : err);
    }
    for (const o of owners) {
      try {
        await deps.mailer.send({ to: o.email, ...email });
      } catch (err) {
        // Never log the address or the message body.
        console.error('[plan-renewals] email failed for business', row.businessId, err instanceof Error ? err.message : err);
      }
    }
    if (kind === 'due') out.reminders++;
    else if (kind === 'grace') out.ended++;
    else out.paused++;
  }
  return out;
}
