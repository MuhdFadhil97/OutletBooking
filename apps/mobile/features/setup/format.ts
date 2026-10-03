import { formatInTimeZone } from 'date-fns-tz';
import { WEEKDAY_SHORT, type PriceRule, type Service, type WorkingHour } from '@outletbooking/shared';
import { formatDuration, formatRM, formatTime } from '@/lib/format';
import { t } from '@/strings/en';

/** Monday-first display order (0 = Sunday in data). */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** [1,2,3,4,5] → "Mon–Fri", [6,0] → "Sat–Sun", [1,3] → "Mon, Wed" */
export function formatWeekdays(days: number[]): string {
  const sorted = WEEK_ORDER.filter((d) => days.includes(d));
  if (sorted.length === 7) return 'Every day';
  // Runs of consecutive days by position in the Monday-first week.
  const runs: number[][] = [];
  sorted.forEach((d, i) => {
    const last = runs[runs.length - 1];
    if (last && i > 0 && WEEK_ORDER.indexOf(d) === WEEK_ORDER.indexOf(sorted[i - 1]!) + 1) last.push(d);
    else runs.push([d]);
  });
  return runs
    .map((r) => (r.length > 1 ? `${WEEKDAY_SHORT[r[0]!]}–${WEEKDAY_SHORT[r[r.length - 1]!]}` : WEEKDAY_SHORT[r[0]!]))
    .join(', ');
}

/** Rules are stored one row per weekday; the editor shows them grouped. */
export interface PriceRuleGroup {
  name: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  priceSen: number;
}

export function groupPriceRules(rules: Omit<PriceRule, 'id'>[]): PriceRuleGroup[] {
  const groups = new Map<string, PriceRuleGroup>();
  for (const r of rules) {
    const key = `${r.name}|${r.startTime}|${r.endTime}|${r.priceSen}`;
    const g = groups.get(key);
    if (g) g.weekdays.push(r.weekday);
    else groups.set(key, { name: r.name, weekdays: [r.weekday], startTime: r.startTime, endTime: r.endTime, priceSen: r.priceSen });
  }
  return [...groups.values()];
}

export function formatTimeRange(start: string, end: string): string {
  if (start === '00:00' && end === '24:00') return 'all day';
  return `${formatTime(start)} – ${formatTime(end)}`;
}

export function serviceSummary(svc: Service): string {
  const durations = svc.durationOptions?.length
    ? svc.durationOptions.map(formatDuration).join(' / ')
    : formatDuration(svc.durationMin);
  const price = svc.priceSen
    ? `${formatRM(svc.priceSen)}${svc.priceUnit === 'per_block' ? t.setup.services.perBlockShort : ''}`
    : 'Free';
  return `${durations} · ${price}`;
}

/** One line per weekday: "8:00 AM – 12:30 PM, 2:30 PM – 12:00 AM" */
export function hoursForDay(hours: Pick<WorkingHour, 'weekday' | 'startTime' | 'endTime'>[], weekday: number): string {
  return hours
    .filter((h) => h.weekday === weekday)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((h) => formatTimeRange(h.startTime, h.endTime))
    .join(', ');
}

/**
 * Time off in the business timezone: whole days → "20 Oct" / "20 – 21 Oct";
 * otherwise "2 Nov · 9:00 AM – 1:00 PM".
 */
export function formatTimeOffRange(startIso: string, endIso: string, tz: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const st = formatInTimeZone(start, tz, 'HH:mm');
  const et = formatInTimeZone(end, tz, 'HH:mm');
  if (st === '00:00' && et === '00:00') {
    const a = formatInTimeZone(start, tz, 'd MMM');
    const b = formatInTimeZone(new Date(end.getTime() - 1), tz, 'd MMM');
    return a === b ? a : `${a} – ${b}`;
  }
  const sameDay = formatInTimeZone(start, tz, 'yyyy-MM-dd') === formatInTimeZone(new Date(end.getTime() - 1), tz, 'yyyy-MM-dd');
  if (sameDay) return `${formatInTimeZone(start, tz, 'd MMM')} · ${formatTimeRange(st, et === '00:00' ? '24:00' : et)}`;
  return `${formatInTimeZone(start, tz, 'd MMM, h:mm a')} – ${formatInTimeZone(end, tz, 'd MMM, h:mm a')}`;
}
