import { and, asc, eq } from 'drizzle-orm';
import { bookingEvents, users, type Db, type Tx } from '@outletbooking/db';
import type { BookingEvent, BookingEventType, BookingStatus } from '@outletbooking/shared';

/**
 * Append to the booking timeline. Call inside the transaction that changes the booking,
 * so the event and the change commit (or roll back) together.
 */
export async function recordBookingEvent(
  tx: Tx,
  e: {
    businessId: number;
    bookingId: number;
    type: BookingEventType;
    /** null = customer (web page) or system. */
    actorUserId: number | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(bookingEvents).values({
    businessId: e.businessId,
    bookingId: e.bookingId,
    eventType: e.type,
    actorUserId: e.actorUserId,
    details: e.details ?? {},
  });
}

/** Status a booking moves to → the event it writes. */
export const STATUS_EVENT: Record<Exclude<BookingStatus, 'pending'>, BookingEventType> = {
  confirmed: 'confirmed',
  checked_in: 'checked_in',
  completed: 'completed',
  cancelled: 'cancelled',
  no_show: 'no_show',
};

/** Timeline for one booking, oldest first. The caller has already checked the booking is visible. */
export async function listBookingEvents(q: Db | Tx, businessId: number, bookingId: number): Promise<BookingEvent[]> {
  const rows = await q
    .select({
      id: bookingEvents.id,
      type: bookingEvents.eventType,
      actorId: users.id,
      actorName: users.name,
      details: bookingEvents.details,
      createdAt: bookingEvents.createdAt,
    })
    .from(bookingEvents)
    .leftJoin(users, eq(users.id, bookingEvents.actorUserId))
    .where(and(eq(bookingEvents.businessId, businessId), eq(bookingEvents.bookingId, bookingId)))
    .orderBy(asc(bookingEvents.createdAt), asc(bookingEvents.id));
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    actor: r.actorId !== null && r.actorName !== null ? { id: r.actorId, name: r.actorName } : null,
    details: r.details,
    createdAt: r.createdAt.toISOString(),
  }));
}
