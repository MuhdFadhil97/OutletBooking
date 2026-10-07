import { WEEKDAY_SHORT } from './setup';

export interface HoursRow {
  weekday: number;
  startTime: string;
  endTime: string;
}

/** Monday first, the way people read a week. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** "08:00" → "8 AM", "08:30" → "8:30 AM", "24:00" → "12 AM" */
export function shortTime(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const h24 = h % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/**
 * Weekly hours as short lines, consecutive days with the same hours grouped:
 * [{ days: "Mon–Fri", hours: "8 AM–12 AM" }, { days: "Sun", hours: null }] (null = closed)
 */
export function groupWeeklyHours(rows: HoursRow[]): { days: string; hours: string | null }[] {
  const dayText = (d: number) =>
    rows
      .filter((r) => r.weekday === d)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map((r) => `${shortTime(r.startTime)}–${shortTime(r.endTime)}`)
      .join(', ') || null;

  const groups: { from: number; to: number; hours: string | null }[] = [];
  for (const d of WEEK_ORDER) {
    const hours = dayText(d);
    const last = groups.at(-1);
    if (last && last.hours === hours) last.to = d;
    else groups.push({ from: d, to: d, hours });
  }
  return groups.map((g) => ({
    days: g.from === g.to ? WEEKDAY_SHORT[g.from]! : `${WEEKDAY_SHORT[g.from]}–${WEEKDAY_SHORT[g.to]}`,
    hours: g.hours,
  }));
}

/** One line for a summary row, open days only: "Mon–Fri 8 AM–12 AM · Sat–Sun 7 AM–12 AM". */
export function weeklyHoursLine(rows: HoursRow[]): string {
  return groupWeeklyHours(rows)
    .filter((g) => g.hours)
    .map((g) => `${g.days} ${g.hours}`)
    .join(' · ');
}

/** Template hour blocks → one row per weekday. */
export function expandHours(blocks: { weekdays: number[]; startTime: string; endTime: string }[]): HoursRow[] {
  return blocks.flatMap((b) => b.weekdays.map((weekday) => ({ weekday, startTime: b.startTime, endTime: b.endTime })));
}
