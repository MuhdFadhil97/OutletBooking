import { useEffect, useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import type { Booking, HoursRow, MyTimeOff } from '@outletbooking/shared';
import { formatDuration } from '@/lib/format';

/** "Nurul Huda" → "NH" */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** Current time, refreshed every 30 s (for "Next · in 25 min"). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** 25 min, 1 hour, 2 h 5 min — rounded up to the minute. */
export const formatIn = (ms: number) => formatDuration(Math.max(1, Math.ceil(ms / 60_000)));

/**
 * S1 focus card: the job in progress, else the first booking not finished yet.
 * Returns its id, or null when everything today is done.
 */
export function focusBookingId(bookings: Booking[], now: number): number | null {
  const inProgress = bookings.find((b) => b.status === 'checked_in');
  if (inProgress) return inProgress.id;
  const next = bookings.find((b) => (b.status === 'confirmed' || b.status === 'pending') && Date.parse(b.endAt) > now);
  return next?.id ?? null;
}

/** First answer to a booking question (property ref, plate number…), shown under the service name. */
export const firstAnswer = (b: Booking): string | null => {
  const v = Object.values(b.customFields).find((x) => x !== '');
  return v === undefined ? null : String(v);
};

/** G2: why a day has no work — a day off / closure, or no hours that weekday. */
export function dayOffLabel(
  date: string,
  hours: HoursRow[],
  timeOff: MyTimeOff[],
  tz: string,
): 'closed' | 'dayOff' | null {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  // Time off that covers the whole working day counts as a day off.
  const startOfDay = `${date}T00:00`;
  const endOfDay = `${date}T23:59`;
  const covering = timeOff.find((t) => {
    const s = formatInTimeZone(new Date(t.startAt), tz, "yyyy-MM-dd'T'HH:mm");
    const e = formatInTimeZone(new Date(t.endAt), tz, "yyyy-MM-dd'T'HH:mm");
    return s <= startOfDay && e >= endOfDay;
  });
  if (covering) return covering.resourceId === null ? 'closed' : 'dayOff';
  return hours.some((h) => h.weekday === weekday) ? null : 'dayOff';
}
