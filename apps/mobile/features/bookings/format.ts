import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import type { Booking, BookingStatus } from '@outletbooking/shared';
import type { TagTone } from '@/components/ui/Tag';
import { formatRM } from '@/lib/format';
import { t } from '@/strings/en';

/** Local "yyyy-MM-dd" date helpers (calendar dates, no timezone math). */
export const shiftDate = (date: string, days: number) => format(addDays(parseISO(date), days), 'yyyy-MM-dd');
export const weekStart = (date: string) => format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), 'yyyy-MM-dd');
export const todayIn = (tz: string) => formatInTimeZone(new Date(), tz, 'yyyy-MM-dd');

/** "Saturday, 10 Oct" */
export const formatDayTitle = (date: string) => format(parseISO(date), 'EEEE, d MMM');
/** "5 – 11 Oct" / "29 Sep – 5 Oct" */
export function formatWeekTitle(monday: string) {
  const a = parseISO(monday);
  const b = addDays(a, 6);
  return a.getMonth() === b.getMonth() ? `${format(a, 'd')} – ${format(b, 'd MMM')}` : `${format(a, 'd MMM')} – ${format(b, 'd MMM')}`;
}

/** Minutes since local midnight of `date` (can be < 0 or > 1440 for neighbouring days). */
export function minutesInDay(iso: string, date: string, tz: string): number {
  const local = formatInTimeZone(new Date(iso), tz, "yyyy-MM-dd'T'HH:mm");
  const dayDiff = Math.round((parseISO(local.slice(0, 10)).getTime() - parseISO(date).getTime()) / 86_400_000);
  return dayDiff * 1440 + Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
}

/** "6–8 PM", "10:00–11:30 AM", "11 AM–1 PM" */
export function formatTimeSpan(startIso: string, endIso: string, tz: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const short = (d: Date) => formatInTimeZone(d, tz, formatInTimeZone(d, tz, 'mm') === '00' ? 'h' : 'h:mm');
  const sa = formatInTimeZone(s, tz, 'a');
  const ea = formatInTimeZone(e, tz, 'a');
  return sa === ea ? `${short(s)}–${short(e)} ${ea}` : `${short(s)} ${sa}–${short(e)} ${ea}`;
}

/** "Mon, 12 Oct · 10:00–11:30 AM" */
export const formatWhen = (b: Pick<Booking, 'startAt' | 'endAt'>, tz: string) =>
  `${formatInTimeZone(new Date(b.startAt), tz, 'EEE, d MMM')} · ${formatTimeSpan(b.startAt, b.endAt, tz)}`;

export const statusTone: Record<BookingStatus, TagTone> = {
  pending: 'pending',
  confirmed: 'ok',
  checked_in: 'info',
  completed: 'neutral',
  cancelled: 'neutral',
  no_show: 'neutral',
};

/** Calendar block colours (wireframe .e-ok / .e-pend / .e-walk). */
export function eventStyle(b: Booking): { bg: string; border: string; fg: string } {
  if (b.status === 'pending') return { bg: '#FDEBD3', border: '#F2C58E', fg: '#7A4105' };
  if (b.source === 'walk_in') return { bg: '#E0ECFB', border: '#A9C6EE', fg: '#1D4F91' };
  if (b.status === 'completed') return { bg: '#E9ECEA', border: '#CBD3CE', fg: '#46524B' };
  return { bg: '#DDF3E8', border: '#9FD5BB', fg: '#0B5E40' };
}

/** Short payment note for calendar blocks: "Paid" / "Unpaid" / nothing. */
export function paymentNote(b: Booking): string | null {
  if (b.paymentStatus === 'paid') return t.booking.paid;
  if (b.paymentStatus === 'unpaid') return t.booking.unpaid;
  return null;
}

/** WhatsApp click-to-chat link for an E.164 number. */
export const whatsappUrl = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;
export const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
export const wazeUrl = (address: string) => `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;

/** "+60132221188" → "+60 13-222 1188" (Malaysian mobiles); other numbers unchanged. */
export function formatPhone(e164: string): string {
  const m = /^\+60(1\d)(\d{3,4})(\d{4})$/.exec(e164);
  return m ? `+60 ${m[1]}-${m[2]} ${m[3]}` : e164;
}

/** Bookings list (O9) payment line: "RM 180 due", "Deposit pending", "Paid", "Deposit kept". */
export function paymentSummary(b: Booking): string | null {
  const l = t.bookingsList;
  if (b.priceSen === 0) return t.booking.free;
  const depositOnly = b.amountDueSen > 0 && b.amountDueSen < b.priceSen;
  if (b.status === 'cancelled' || b.status === 'no_show') {
    return b.paymentStatus === 'paid' ? (depositOnly ? l.depositKept : t.booking.paid) : null;
  }
  if (b.paymentStatus === 'paid') {
    const balance = b.priceSen - b.amountDueSen;
    return balance > 0 ? l.due(formatRM(balance)) : t.booking.paid;
  }
  if (b.paymentStatus === 'unpaid' && b.amountDueSen > 0) return depositOnly ? l.depositPending : l.paymentPending;
  return b.status === 'completed' ? null : l.due(formatRM(b.priceSen));
}
