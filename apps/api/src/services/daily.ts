import { formatInTimeZone } from 'date-fns-tz';
import { and, count, eq, gte, inArray, isNull, lt, ne, sum } from 'drizzle-orm';
import {
  bookings,
  businesses,
  businessMembers,
  customers,
  notifications,
  payments,
  resources,
  subscriptions,
  users,
  type Db,
} from '@outletbooking/db';
import { resolveNotificationPrefs } from '@outletbooking/shared';
import { localDayRange } from './availability';
import { trialEndingEmail } from './billing-emails';
import type { Mailer } from './mailer';
import { notify, pushToUsers, recipientsFor } from './notifications';
import { getBusinessPlanFeatures } from './plan-catalog';
import type { PushSender } from './push';
import type { Env } from '../env';

const DAY_MS = 86_400_000;

/**
 * FR-10.2 · Morning push to each active member: today's bookings they can see
 * (owners / "sees all bookings": everything; other staff: their linked resources). Nobody with 0 bookings is pinged.
 */
export async function staffDaySummary(db: Db, sender: PushSender, now = new Date()): Promise<number> {
  const bizRows = await db
    .select({ id: businesses.id, timezone: businesses.timezone })
    .from(businesses)
    .where(isNull(businesses.deletedAt));
  let sent = 0;
  for (const biz of bizRows) {
    const today = formatInTimeZone(now, biz.timezone, 'yyyy-MM-dd');
    const { start, end } = localDayRange(today, biz.timezone);
    const day = await db
      .select({ startAt: bookings.startAt, resourceUserId: resources.userId })
      .from(bookings)
      .innerJoin(resources, and(eq(resources.businessId, bookings.businessId), eq(resources.id, bookings.resourceId)))
      .where(
        and(
          eq(bookings.businessId, biz.id),
          inArray(bookings.status, ['pending', 'confirmed']),
          lt(bookings.startAt, end),
          gte(bookings.startAt, start),
        ),
      );
    if (!day.length) continue;
    const members = await db
      .select({
        userId: businessMembers.userId,
        role: businessMembers.role,
        canViewAll: businessMembers.canViewAll,
        prefs: businessMembers.notificationPrefs,
      })
      .from(businessMembers)
      .where(and(eq(businessMembers.businessId, biz.id), eq(businessMembers.isActive, true)));
    const staffApp = (await getBusinessPlanFeatures(db, biz.id)).staff_app;
    for (const m of members) {
      if (m.role !== 'owner' && !staffApp) continue; // staff are hidden on a plan without the staff app
      if (!resolveNotificationPrefs(m.prefs).daySummary) continue; // G3 switch
      const mine = m.role === 'owner' || m.canViewAll ? day : day.filter((b) => b.resourceUserId === m.userId);
      if (!mine.length) continue;
      const first = mine.reduce((a, b) => (a.startAt < b.startAt ? a : b)).startAt;
      await pushToUsers(db, sender, [m.userId], {
        title: `Today: ${mine.length} booking${mine.length === 1 ? '' : 's'}`,
        body: `First at ${formatInTimeZone(first, biz.timezone, 'h:mm a')}. Open the app for your schedule.`,
        data: { type: 'day_summary', date: today },
      });
      sent++;
    }
  }
  return sent;
}

/**
 * FR-16.2 · Trial reminders to owners, once each: "ends in N days" from day 5 of 7, and "ended".
 * With `mail`, the owner also gets the M5 email (what the business did during the trial) together with the push.
 * (Pausing the booking page after the trial is Phase 6, F3 / E4.)
 */
export async function trialReminders(
  db: Db,
  sender: PushSender,
  now = new Date(),
  mail?: { mailer: Mailer; env: Pick<Env, 'WEBSITE_URL'> },
): Promise<number> {
  const trials = await db
    .select({
      businessId: subscriptions.businessId,
      trialEndsAt: subscriptions.trialEndsAt,
      trialStartedAt: subscriptions.createdAt,
      businessName: businesses.name,
    })
    .from(subscriptions)
    .innerJoin(businesses, and(eq(businesses.id, subscriptions.businessId), isNull(businesses.deletedAt)))
    .where(and(eq(subscriptions.status, 'trialing'), lt(subscriptions.trialEndsAt, new Date(now.getTime() + 2 * DAY_MS + 1))));
  let sent = 0;
  for (const t of trials) {
    const ended = t.trialEndsAt <= now;
    const type = ended ? 'trial_ended' : 'trial_ending';
    const [already] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.businessId, t.businessId), eq(notifications.type, type)))
      .limit(1);
    if (already) continue;
    const daysLeft = Math.max(1, Math.ceil((t.trialEndsAt.getTime() - now.getTime()) / DAY_MS));
    await notify(db, sender, await recipientsFor(db, t.businessId), {
      businessId: t.businessId,
      type,
      title: ended ? 'Your free trial has ended' : `Free trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
      body: ended ? 'Choose a plan to turn your booking page back on.' : 'Choose a plan to keep your booking page live.',
    });
    if (mail) await sendTrialEmail(db, mail, t, ended, now);
    sent++;
  }
  return sent;
}

/** M5 · One email per owner. A failure is logged (never the address) and does not stop the other businesses. */
async function sendTrialEmail(
  db: Db,
  mail: { mailer: Mailer; env: Pick<Env, 'WEBSITE_URL'> },
  t: { businessId: number; trialEndsAt: Date; trialStartedAt: Date; businessName: string },
  ended: boolean,
  now: Date,
): Promise<void> {
  try {
    const [[b], [p], [c], owners] = await Promise.all([
      db
        .select({ n: count() })
        .from(bookings)
        .where(and(eq(bookings.businessId, t.businessId), ne(bookings.status, 'cancelled'), gte(bookings.createdAt, t.trialStartedAt))),
      db
        .select({ sen: sum(payments.amountSen) })
        .from(payments)
        .where(
          and(
            eq(payments.businessId, t.businessId),
            eq(payments.purpose, 'booking'),
            eq(payments.status, 'paid'),
            gte(payments.paidAt, t.trialStartedAt),
          ),
        ),
      db
        .select({ n: count() })
        .from(customers)
        .where(and(eq(customers.businessId, t.businessId), gte(customers.createdAt, t.trialStartedAt))),
      db
        .select({ email: users.email })
        .from(businessMembers)
        .innerJoin(users, eq(users.id, businessMembers.userId))
        .where(and(eq(businessMembers.businessId, t.businessId), eq(businessMembers.role, 'owner'), eq(businessMembers.isActive, true))),
    ]);
    const website = mail.env.WEBSITE_URL.replace(/\/+$/, '');
    const days = Math.max(1, Math.floor((Math.min(now.getTime(), t.trialEndsAt.getTime()) - t.trialStartedAt.getTime()) / DAY_MS));
    const email = trialEndingEmail({
      businessName: t.businessName,
      ended,
      endsOn: formatInTimeZone(t.trialEndsAt, 'Asia/Kuala_Lumpur', 'EEE, d MMM'),
      stats: { days, bookings: b?.n ?? 0, paidSen: Number(p?.sen ?? 0), newCustomers: c?.n ?? 0 },
      planUrl: `${website}/billing/sign-in`,
      websiteUrl: website,
    });
    for (const o of owners) await mail.mailer.send({ to: o.email, ...email, meta: { template: 'trial_ending', businessId: t.businessId } });
  } catch (err) {
    console.error('[trial-reminders] email failed for business', t.businessId, err instanceof Error ? err.message : err);
  }
}

