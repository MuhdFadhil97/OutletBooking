import { and, count, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { businessMembers, notifications, pushTokens, type Db } from '@outletbooking/db';
import type { AppNotification, NotificationList, NotificationRead, NotificationType } from '@outletbooking/shared';
import type { PushSender } from './push';

export interface NewNotification {
  businessId: number;
  type: NotificationType;
  title: string;
  body: string;
  bookingId?: number | null;
}

/**
 * Active members who should hear about something: every owner, plus the staff login linked to
 * the booked resource (if any).
 */
export async function recipientsFor(db: Db, businessId: number, linkedUserId: number | null = null): Promise<number[]> {
  const rows = await db
    .select({ userId: businessMembers.userId })
    .from(businessMembers)
    .where(
      and(
        eq(businessMembers.businessId, businessId),
        eq(businessMembers.isActive, true),
        linkedUserId === null
          ? eq(businessMembers.role, 'owner')
          : or(eq(businessMembers.role, 'owner'), eq(businessMembers.userId, linkedUserId)),
      ),
    );
  return [...new Set(rows.map((r) => r.userId))];
}

/** D6 row per recipient, then an Expo push to their devices. Dead device tokens are removed. */
export async function notify(db: Db, sender: PushSender, userIds: number[], n: NewNotification): Promise<void> {
  if (!userIds.length) return;
  await db.insert(notifications).values(
    userIds.map((userId) => ({
      businessId: n.businessId,
      userId,
      type: n.type,
      title: n.title,
      body: n.body,
      bookingId: n.bookingId ?? null,
    })),
  );

  const rows = await db.select({ token: pushTokens.token }).from(pushTokens).where(inArray(pushTokens.userId, userIds));
  const tokens = [...new Set(rows.map((r) => r.token))];
  if (!tokens.length) return;
  const tickets = await sender.send(
    tokens.map((to) => ({
      to,
      title: n.title,
      body: n.body,
      sound: 'default' as const,
      channelId: 'bookings',
      data: { type: n.type, ...(n.bookingId ? { bookingId: n.bookingId } : {}) },
    })),
  );
  // Uninstalled apps / logged-out devices: stop sending to them.
  const dead = tickets.flatMap((t, i) => (t.status === 'error' && t.details?.error === 'DeviceNotRegistered' ? [tokens[i]!] : []));
  if (dead.length) await db.delete(pushTokens).where(inArray(pushTokens.token, dead));
}

/** The caller's own notifications in their current business, newest first. */
export async function listNotifications(
  db: Db,
  businessId: number,
  userId: number,
  limit: number,
): Promise<NotificationList> {
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
      .limit(limit),
    db.select({ n: count() }).from(notifications).where(and(mine, isNull(notifications.readAt))),
  ]);
  return {
    items: rows.map(
      ({ readAt, createdAt, type, ...r }): AppNotification => ({
        ...r,
        type: type as NotificationType,
        read: readAt !== null,
        createdAt: createdAt.toISOString(),
      }),
    ),
    unreadCount: unread?.n ?? 0,
  };
}

/** Only the caller's own rows are touched; other ids are ignored. */
export async function markNotificationsRead(db: Db, businessId: number, userId: number, input: NotificationRead): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.businessId, businessId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        input.ids ? inArray(notifications.id, input.ids) : undefined,
      ),
    );
}
