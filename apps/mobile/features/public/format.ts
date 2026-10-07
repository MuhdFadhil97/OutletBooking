import { addDays, format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import type { PublicBusiness, PublicService } from '@outletbooking/shared';
import { formatDuration, formatRM } from '@/lib/format';
import { t } from '@/strings/en';

const b = t.book;

/** "1–3 hours" for customer-chosen lengths, else "60 min". */
export function durationsLabel(svc: PublicService): string {
  const opts = svc.durationOptions?.length ? svc.durationOptions : null;
  if (!opts) return formatDuration(svc.durationMin);
  const [min, max] = [Math.min(...opts), Math.max(...opts)];
  if (min === max) return formatDuration(min);
  return min % 60 === 0 && max % 60 === 0 ? `${min / 60}–${max / 60} hours` : `${formatDuration(min)}–${formatDuration(max)}`;
}

/** "from RM 20/hr", "RM 180", "Free". */
export function priceLabel(svc: PublicService, pricesFrom?: boolean): string {
  if (svc.priceSen === 0) return b.free;
  const unit = svc.priceUnit === 'per_block' ? (svc.durationMin === 60 ? b.perHour : b.per(formatDuration(svc.durationMin))) : '';
  const price = `${formatRM(svc.priceSen)}${unit}`;
  return pricesFrom || svc.priceUnit === 'per_block' ? b.from(price) : price;
}

/** Header line: "Open today 8 AM–12 AM" / "Closed today". */
export function todayHours(biz: PublicBusiness, short: (hhmm: string) => string): string {
  const weekday = Number(formatInTimeZone(new Date(), biz.timezone, 'i')) % 7; // ISO 1–7 → 0 = Sunday
  const h = biz.hours.find((x) => x.weekday === weekday);
  return h ? b.openToday(`${short(h.startTime)}–${short(h.endTime)}`) : b.closedToday;
}

export const slotTime = (iso: string, tz: string) => formatInTimeZone(new Date(iso), tz, 'h:mm a');
export const slotHour = (iso: string, tz: string) => Number(formatInTimeZone(new Date(iso), tz, 'H'));

/** Date strip: the next days customers can book (today first). */
export function bookableDays(today: string, maxDaysAhead: number, count = 14) {
  return Array.from({ length: Math.min(count, maxDaysAhead + 1) }, (_, i) => {
    const d = addDays(parseISO(today), i);
    return { date: format(d, 'yyyy-MM-dd'), weekday: format(d, 'EEE'), day: format(d, 'd'), month: format(d, 'MMMM yyyy') };
  });
}

export const longDate = (date: string) => format(parseISO(date), 'EEE, d MMM');

/** "Sat, 10 Oct · 8:00 – 10:00 PM" in the business timezone. */
export function whenLine(startIso: string, endIso: string, tz: string): string {
  const day = formatInTimeZone(new Date(startIso), tz, 'EEE, d MMM');
  const s = formatInTimeZone(new Date(startIso), tz, 'h:mm a');
  const e = formatInTimeZone(new Date(endIso), tz, 'h:mm a');
  return `${day} · ${s} – ${e}`;
}

/** Google Calendar "add event" link (works on phones and desktop, no file download). */
export function calendarUrl(p: { title: string; startIso: string; endIso: string; details: string; location?: string | null }) {
  const fmt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: p.title,
    dates: `${fmt(p.startIso)}/${fmt(p.endIso)}`,
    details: p.details,
    ...(p.location ? { location: p.location } : {}),
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
