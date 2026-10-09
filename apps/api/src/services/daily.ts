import { formatInTimeZone } from 'date-fns-tz';
import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { bookings, businesses, businessMembers, notifications, resources, subscriptions, type Db } from '@outletbooking/db';
import { localDayRange } from './availability';
import { notify, pushToUsers, recipientsFor } from './notifications';
import type { PushSender } from './push';

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
      .select({ userId: businessMembers.userId, role: businessMembers.role, canViewAll: businessMembers.canViewAll })
      .from(businessMembers)
      .where(and(eq(businessMembers.businessId, biz.id), eq(businessMembers.isActive, true)));
    for (const m of members) {
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
 * (Pausing the booking page after the trial is Phase 6, F3 / E4.)
 */
export async function trialReminders(db: Db, sender: PushSender, now = new Date()): Promise<number> {
  const trials = await db
    .select({ businessId: subscriptions.businessId, trialEndsAt: subscriptions.trialEndsAt })
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
    sent++;
  }
  return sent;
}

