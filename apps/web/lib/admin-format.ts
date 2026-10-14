/** Dates in the admin panel are shown in Malaysia time, whatever the admin's computer is set to. */
const TZ = 'Asia/Kuala_Lumpur';

const dayFormat = new Intl.DateTimeFormat('en-MY', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const dateFormat = new Intl.DateTimeFormat('en-MY', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat('en-MY', {
  timeZone: TZ,
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const ymdFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "Sat, 17 Oct" */
export const formatDay = (iso: string) => dayFormat.format(new Date(iso));
/** "3 Oct 2026" */
export const formatDate = (iso: string) => dateFormat.format(new Date(iso));
/** "1 Oct, 10:12 am" */
export const formatDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));
/** "2026-10-17" (Malaysia calendar day), for <input type="date">. */
export const ymdInMalaysia = (date: Date) => ymdFormat.format(date);

/** Whole Malaysia calendar days from `now` until `iso` (0 = today, negative = past). */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const day = (d: Date) => Date.parse(`${ymdInMalaysia(d)}T00:00:00Z`);
  return Math.round((day(new Date(iso)) - day(now)) / 86_400_000);
}

/**
 * `months` calendar months after `iso`, as the API counts them (Malaysia time, no daylight saving:
 * 31 Jan + 1 month = 28/29 Feb).
 */
export function addMonthsMalaysia(iso: string, months: number): string {
  const OFFSET = 8 * 3_600_000;
  const local = new Date(Date.parse(iso) + OFFSET);
  const day = local.getUTCDate();
  local.setUTCDate(1);
  local.setUTCMonth(local.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
  local.setUTCDate(Math.min(day, lastDay));
  return new Date(local.getTime() - OFFSET).toISOString();
}

/** wa.me link for a Malaysian E.164 number (+60…). */
export function whatsappLink(phone: string, text?: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/** "+60 12-345 6789" for display; anything unexpected is shown as stored. */
export function formatPhone(phone: string): string {
  const m = /^\+60(1\d)(\d{3,4})(\d{4})$/.exec(phone);
  return m ? `+60 ${m[1]}-${m[2]} ${m[3]}` : phone;
}
