import { formatInTimeZone } from 'date-fns-tz';
import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import {
  bookings,
  businesses,
  businessMembers,
  customers,
  notifications,
  pushTokens,
  resources,
  users,
  type Db,
  type Tx,
} from '@outletbooking/db';
import type { AppNotification, NotificationList, NotificationType, PushTokenInput } from '@outletbooking/shared';
import { notFound } from '../errors';
import type { PushMessage, PushSender } from './push';

type Q = Db | Tx;

interface Pending {
  userId: number;
  type: NotificationType;
  title: string;
  body: string | null;
  bookingId: number | null;
}

/**
 * Collects the notifications a request creates. `add*` inserts the rows inside the caller's
 * transaction (so they commit with the change); `flush` sends push after the commit.
 * Services take one as an optional last argument; routes flush it.
 */
export class Outbox {
  private pending: Pending[] = [];

  async add(tx: Tx, businessId: number, recipients: number[], n: Omit<Pending, 'userId'>): Promise<void> {
    const userIds = [...new Set(recipients)];
    if (!userIds.length) return;
    await tx.insert(notifications).values(userIds.map((userId) => ({ businessId, userId, ...n })));
    this.pending.push(...userIds.map((userId) => ({ userId, ...n })));
  }

  /** Best-effort push to every device of every recipient. Never throws. */
  async flush(db: Db, push: PushSender): Promise<void> {
    const pending = this.pending;
    this.pending = [];
    if (!pending.length) return;
    try {
      const tokens = await db
        .select({ userId: pushTokens.userId, token: pushTokens.token })
        .from(pushTokens)
        .where(inArray(pushTokens.userId, [...new Set(pending.map((p) => p.userId))]));
      const messages: PushMessage[] = pending.flatMap((p) =>
        tokens
          .filter((t) => t.userId === p.userId)
          .map((t) => ({
            to: t.token,
            title: p.title,
            ...(p.body ? { body: p.body } : {}),
            data: {
              type: p.type,
              ...(p.bookingId ? { bookingId: p.bookingId } : {}),
            },
          })),
      );
      if (!messages.length) return;
      const { deadTokens } = await push.send(messages);
      if (deadTokens.length) await db.delete(pushTokens).where(inArray(pushTokens.token, deadTokens));
    } catch (err) {
      console.error('[push] not sent:', err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Who hears about a booking: active owners, staff who can see every booking, and the staff
 * member linked to the booking's resource — minus whoever made the change.
 */
async function bookingRecipients(q: Q, businessId: number, resourceId: number, exceptUserId: number | null) {
  const rows = await q
    .select({ userId: businessMembers.userId })
    .from(businessMembers)
    .where(
      and(
        eq(businessMembers.businessId, businessId),
        eq(businessMembers.isActive, true),
        or(
          eq(businessMembers.role, 'owner'),
          eq(businessMembers.canViewAll, true),
          sql`exists (select 1 from ${resources} r where r.business_id = ${businessId} and r.id = ${resourceId} and r.user_id = ${businessMembers.userId})`,
        ),
        exceptUserId === null ? undefined : ne(businessMembers.userId, exceptUserId),
      ),
    );
  return rows.map((r) => r.userId);
}

const rm = (sen: number) => `RM ${sen % 100 === 0 ? sen / 100 : (sen / 100).toFixed(2)}`;

/** "Ahmad · Court 2 · Sat 10 Oct, 8:00–10:00 PM" in the business time zone. */
async function bookingSummary(q: Q, businessId: number, bookingId: number) {
  const [b] = await q
    .select({
      resourceId: bookings.resourceId,
      startAt: bookings.startAt,
      endAt: bookings.endAt,
      priceSen: bookings.priceSen,
      customerName: customers.name,
      resourceName: resources.name,
      timezone: businesses.timezone,
    })
    .from(bookings)
    .innerJoin(businesses, eq(businesses.id, bookings.businessId))
    .innerJoin(customers, and(eq(customers.businessId, bookings.businessId), eq(customers.id, bookings.customerId)))
    .innerJoin(resources, and(eq(resources.businessId, bookings.businessId), eq(resources.id, bookings.resourceId)))
    .where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId)));
  if (!b) throw notFound('Booking');
  const day = formatInTimeZone(b.startAt, b.timezone, 'EEE d MMM');
  const from = formatInTimeZone(b.startAt, b.timezone, 'h:mm a');
  const to = formatInTimeZone(b.endAt, b.timezone, 'h:mm a');
  return { ...b, when: `${day}, ${from}–${to}` };
}

export type BookingNotice =
  /** Customer booked on the web page (customerName: the name as typed). */
  | { kind: 'web_booking'; customerName: string; awaitingPayment: boolean }
  /** Owner / staff added a booking (walk-in or otherwise). */
  | { kind: 'added'; walkIn: boolean }
  | { kind: 'cancelled'; byCustomer: boolean }
  /** Online payment confirmed. `released`: paid after the hold ended and the slot was taken — refund. */
  | { kind: 'paid'; amountSen: number; released?: boolean }
  /** The bank did not confirm the payment; `heldUntil` = when the slot is released. */
  | { kind: 'payment_failed'; heldUntil: Date | null }
  /** Not paid within the hold time — slot released. */
  | { kind: 'expired' };

/** Writes the notifications for one booking change. Call inside the transaction that made it. */
export async function notifyBooking(
  tx: Tx,
  outbox: Outbox,
  businessId: number,
  bookingId: number,
  actorUserId: number | null,
  notice: BookingNotice,
): Promise<void> {
  const b = await bookingSummary(tx, businessId, bookingId);
  const recipients = await bookingRecipients(tx, businessId, b.resourceId, actorUserId);
  if (!recipients.length) return;
  const actorName = async () => {
    if (actorUserId === null) return null;
    const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, actorUserId));
    return u?.name ?? null;
  };

  let type: NotificationType;
  let title: string;
  let body: string;
  switch (notice.kind) {
    case 'web_booking':
      type = 'booking_new';
      title = notice.awaitingPayment ? 'New booking · awaiting payment' : 'New booking';
      body = `${notice.customerName} · ${b.resourceName} · ${b.when}`;
      break;
    case 'added': {
      const by = await actorName();
      type = notice.walkIn ? 'walk_in' : 'booking_new';
      title = notice.walkIn ? (by ? `Walk-in added by ${by}` : 'Walk-in added') : by ? `New booking by ${by}` : 'New booking';
      body = notice.walkIn
        ? `${b.resourceName} · ${b.when} · ${rm(b.priceSen)}`
        : `${b.customerName} · ${b.resourceName} · ${b.when}`;
      break;
    }
    case 'cancelled': {
      type = 'booking_cancelled';
      const by = notice.byCustomer ? null : await actorName();
      title = notice.byCustomer ? 'Cancelled by customer' : by ? `Booking cancelled by ${by}` : 'Booking cancelled';
      body = `${b.customerName} · ${b.resourceName} · ${b.when}`;
      break;
    }
    case 'paid':
      type = 'booking_paid';
      title = notice.released
        ? `Paid ${rm(notice.amountSen)} after the slot was released — please refund`
        : `New booking · paid ${rm(notice.amountSen)}`;
      body = `${b.customerName} · ${b.resourceName} · ${b.when}`;
      break;
    case 'payment_failed': {
      type = 'payment_failed';
      title = 'Payment not completed';
      const left = notice.heldUntil ? Math.max(0, Math.round((notice.heldUntil.getTime() - Date.now()) / 60_000)) : 0;
      body = `${b.customerName} · ${b.resourceName} · ${left ? `slot held ${left} more min` : b.when}`;
      break;
    }
    case 'expired':
      type = 'booking_cancelled';
      title = 'Not paid in time — slot released';
      body = `${b.customerName} · ${b.resourceName} · ${b.when}`;
      break;
  }
  await outbox.add(tx, businessId, recipients, {
    type,
    title,
    body,
    bookingId,
  });
}

/** Owners hear when a staff member accepts their invite. */
export async function notifyStaffJoined(tx: Tx, outbox: Outbox, businessId: number, staffUserId: number): Promise<void> {
  const owners = await tx
    .select({ userId: businessMembers.userId })
    .from(businessMembers)
    .where(
      and(
        eq(businessMembers.businessId, businessId),
        eq(businessMembers.role, 'owner'),
        eq(businessMembers.isActive, true),
        ne(businessMembers.userId, staffUserId),
      ),
    );
  const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, staffUserId));
  await outbox.add(
    tx,
    businessId,
    owners.map((o) => o.userId),
    {
      type: 'staff_joined',
      title: `${u?.name ?? 'A staff member'} joined your team`,
      body: 'Accepted invite · Staff',
      bookingId: null,
    },
  );
}

const LIST_LIMIT = 50;

/** D6 · the caller's notifications in their current business, newest first. */
export async function listNotifications(db: Db, businessId: number, userId: number): Promise<NotificationList> {
  const mine = and(eq(notifications.businessId, businessId), eq(notifications.userId, userId));
  const [rows, [unread]] = await Promise.all([
    db
      .select({
        id: notifications.id,
        type: notifications.type,
        title: notifications.title,
        body: notifications.body,
        bookingId: notifications.bookingId,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(mine)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(LIST_LIMIT),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(mine, isNull(notifications.readAt))),
  ]);
  const items: AppNotification[] = rows.map(({ readAt, createdAt, ...r }) => ({
    ...r,
    read: readAt !== null,
    createdAt: createdAt.toISOString(),
  }));
  return { items, unread: unread?.n ?? 0 };
}

export async function markNotificationRead(db: Db, businessId: number, userId: number, id: number): Promise<void> {
  const [row] = await db
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(and(eq(notifications.businessId, businessId), eq(notifications.userId, userId), eq(notifications.id, id)))
    .returning({ id: notifications.id });
  if (!row) throw notFound('Notification');
}

export async function markAllNotificationsRead(db: Db, businessId: number, userId: number): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(eq(notifications.businessId, businessId), eq(notifications.userId, userId), isNull(notifications.readAt)));
}

/** A device token belongs to whoever logged in on it last. */
export async function savePushToken(db: Db, userId: number, input: PushTokenInput): Promise<void> {
  await db
    .insert(pushTokens)
    .values({ userId, token: input.token, platform: input.platform })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: { userId, platform: input.platform },
    });
}

export async function deletePushToken(db: Db, userId: number, token: string): Promise<void> {
  await db.delete(pushTokens).where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)));
}
