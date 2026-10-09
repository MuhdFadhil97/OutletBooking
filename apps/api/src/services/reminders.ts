import { addDays, format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { and, eq } from 'drizzle-orm';
import { bookings, businesses, type Db } from '@outletbooking/db';
import type { Booking } from '@outletbooking/shared';
import { notFound } from '../errors';
import { recordBookingEvent } from './booking-events';
import { getBooking, listBookings, type BookingScope } from './bookings';

/** D5: tomorrow's (or `date`'s) confirmed / pending bookings, earliest first, with reminder state. */
export async function listReminders(
  db: Db,
  businessId: number,
  date: string | undefined,
  scope: BookingScope,
  now = new Date(),
): Promise<{ date: string; bookings: Booking[] }> {
  const [biz] = await db.select({ timezone: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId));
  if (!biz) throw notFound('Business');
  const day = date ?? format(addDays(parseISO(formatInTimeZone(now, biz.timezone, 'yyyy-MM-dd')), 1), 'yyyy-MM-dd');
  const next = format(addDays(parseISO(day), 1), 'yyyy-MM-dd');
  const all = await listBookings(db, businessId, { from: day, to: next, includeInactive: false }, scope);
  return { date: day, bookings: all.filter((b) => b.status === 'confirmed' || b.status === 'pending') };
}

/** The owner opened WhatsApp with the reminder for this booking. */
export async function markReminderSent(
  db: Db,
  businessId: number,
  bookingId: number,
  userId: number,
  scope: BookingScope,
): Promise<Booking> {
  await getBooking(db, businessId, bookingId, scope); // visibility check
  return db.transaction(async (tx) => {
    await tx
      .update(bookings)
      .set({ reminderSentAt: new Date() })
      .where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId)));
    await recordBookingEvent(tx, { businessId, bookingId, type: 'reminder_sent', actorUserId: userId, details: { channel: 'whatsapp' } });
    return getBooking(tx, businessId, bookingId, scope);
  });
}
