import { addDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { and, asc, eq, gt, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import {
  bookings,
  businesses,
  businessMembers,
  notifications,
  payments,
  pushTokens,
  resources,
  subscriptions,
  type Db,
} from '@outletbooking/db';
import type { NotificationType } from '@outletbooking/shared';
import { recordBookingEvent } from './booking-events';
import { notifyBooking, Outbox } from './notifications';
import { EXPIRED_REASON, syncBookingBills, type PaymentDeps } from './payments';
import type { PushSender } from './push';

/**
 * Background work, run by pg-boss (src/jobs). Each function is safe to run twice at once and
 * returns what it did, so tests can call it directly.
 */

/**
 * Pending bookings whose payment hold ran out: re-check their bills with ToyyibPay first (a lost
 * callback must not release a paid slot), then release the rest — `expired` event, owner told.
 */
export async function expireUnpaidBookings(db: Db, deps: PaymentDeps, outbox: Outbox, now = new Date()): Promise<number> {
  const due = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.status, 'pending'), lte(bookings.expiresAt, now)))
    .orderBy(asc(bookings.expiresAt))
    .limit(200);
  let released = 0;
  for (const { id } of due) {
    await syncBookingBills(db, deps, id, outbox).catch(() => undefined); // ToyyibPay down: release anyway; a late payment revives
    const done = await db.transaction(async (tx) => {
      const [b] = await tx
        .update(bookings)
        .set({ status: 'cancelled', cancelledAt: now, cancelReason: EXPIRED_REASON })
        .where(and(eq(bookings.id, id), eq(bookings.status, 'pending'), lte(bookings.expiresAt, now)))
        .returning({ businessId: bookings.businessId });
      if (!b) return false; // paid or changed meanwhile
      await tx
        .update(payments)
        .set({ status: 'expired' })
        .where(and(eq(payments.bookingId, id), eq(payments.provider, 'toyyibpay'), eq(payments.status, 'pending')));
      await recordBookingEvent(tx, { businessId: b.businessId, bookingId: id, type: 'expired', actorUserId: null, details: { from: 'pending' } });
      await notifyBooking(tx, outbox, b.businessId, id, null, { kind: 'expired' });
      return true;
    });
    if (done) released++;
  }
  return released;
}

/**
 * FR-10.2 · morning push to each member with a phone registered: today's bookings they can see.
 * Push only (no in-app row). Runs hourly; a business gets it in the hour after 7 AM local time.
 */
export async function sendDaySummaries(db: Db, push: PushSender, now = new Date()): Promise<number> {
  const bizRows = await db.select({ id: businesses.id, timezone: businesses.timezone }).from(businesses);
  const due = bizRows.filter((b) => formatInTimeZone(now, b.timezone, 'H') === '7');
  let sent = 0;
  for (const biz of due) {
    const today = formatInTimeZone(now, biz.timezone, 'yyyy-MM-dd');
    const start = fromZonedTime(`${today}T00:00:00`, biz.timezone);
    const end = addDays(start, 1);
    const members = await db
      .select({ userId: businessMembers.userId, role: businessMembers.role, canViewAll: businessMembers.canViewAll, token: pushTokens.token })
      .from(businessMembers)
      .innerJoin(pushTokens, eq(pushTokens.userId, businessMembers.userId))
      .where(and(eq(businessMembers.businessId, biz.id), eq(businessMembers.isActive, true)));
    if (!members.length) continue;
    const day = await db
      .select({ startAt: bookings.startAt, linkedUserId: resources.userId })
      .from(bookings)
      .innerJoin(resources, and(eq(resources.businessId, bookings.businessId), eq(resources.id, bookings.resourceId)))
      .where(
        and(
          eq(bookings.businessId, biz.id),
          gte(bookings.startAt, start),
          lt(bookings.startAt, end),
          inArray(bookings.status, ['pending', 'confirmed']),
        ),
      )
      .orderBy(asc(bookings.startAt));
    const messages = members.flatMap((m) => {
      const mine = m.role === 'owner' || m.canViewAll ? day : day.filter((b) => b.linkedUserId === m.userId);
      if (!mine.length) return [];
      const first = formatInTimeZone(mine[0]!.startAt, biz.timezone, 'h:mm a');
      return [
        {
          to: m.token,
          title: `Today: ${mine.length} ${mine.length === 1 ? 'booking' : 'bookings'}`,
          body: `First at ${first}. Open OutletBooking for the full list.`,
          data: { type: 'day_summary' },
        },
      ];
    });
    if (!messages.length) continue;
    try {
      const { deadTokens } = await push.send(messages);
      if (deadTokens.length) await db.delete(pushTokens).where(inArray(pushTokens.token, deadTokens));
      sent += messages.length;
    } catch (err) {
      console.error('[jobs] day summary push failed:', err instanceof Error ? err.message : err);
    }
  }
  return sent;
}

/**
 * Trial reminders to owners: "ends in 2 days" (day 5 of 7) and "ended" (day 7). Once each per
 * business — an existing notification of that type means it was already sent.
 */
export async function sendTrialReminders(db: Db, outbox: Outbox, now = new Date()): Promise<number> {
  const rows = await db
    .select({ businessId: subscriptions.businessId, trialEndsAt: subscriptions.trialEndsAt })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, 'trialing'),
        lte(subscriptions.trialEndsAt, addDays(now, 2)),
        gt(subscriptions.trialEndsAt, addDays(now, -3)), // don't remind long-dead trials
      ),
    );
  let created = 0;
  for (const r of rows) {
    const ended = r.trialEndsAt <= now;
    const type: NotificationType = ended ? 'trial_ended' : 'trial_ending';
    created += await db.transaction(async (tx) => {
      // One reminder of each kind per business (lock the business row so two runs can't both send).
      await tx.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, r.businessId)).for('update');
      const [already] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.businessId, r.businessId), eq(notifications.type, type)));
      if ((already?.n ?? 0) > 0) return 0;
      const owners = await tx
        .select({ userId: businessMembers.userId })
        .from(businessMembers)
        .where(and(eq(businessMembers.businessId, r.businessId), eq(businessMembers.role, 'owner'), eq(businessMembers.isActive, true)));
      const days = Math.max(1, Math.ceil((r.trialEndsAt.getTime() - now.getTime()) / 86_400_000));
      await outbox.add(
        tx,
        r.businessId,
        owners.map((o) => o.userId),
        ended
          ? { type, title: 'Your free trial has ended', body: 'Choose a plan to keep your booking page live', bookingId: null }
          : {
              type,
              title: `Free trial ends in ${days} ${days === 1 ? 'day' : 'days'}`,
              body: 'Choose a plan to keep your booking page live',
              bookingId: null,
            },
      );
      return owners.length ? 1 : 0;
    });
  }
  return created;
}
