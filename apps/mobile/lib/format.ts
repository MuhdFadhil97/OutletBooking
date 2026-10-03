/** Display + parsing helpers. Money is always integer sen; times are local "HH:MM". */

/** 3000 → "RM 30", 3050 → "RM 30.50" */
export function formatRM(sen: number): string {
  const rm = sen / 100;
  return `RM ${Number.isInteger(rm) ? rm.toLocaleString('en-MY') : rm.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "30", "30.5", "RM 1,200.50" → sen. Returns null when not a valid amount. */
export function parseRinggit(text: string): number | null {
  const clean = text.replace(/rm/i, '').replace(/[,\s]/g, '');
  if (!clean) return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** sen → editable text: 3000 → "30", 3050 → "30.50" */
export function senToInput(sen: number): string {
  return sen % 100 === 0 ? String(sen / 100) : (sen / 100).toFixed(2);
}

/** "08:00" → "8:00 AM", "24:00" → "12:00 AM" (midnight) */
export function formatTime(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const h24 = h % 24;
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** 90 → "1 h 30 min", 60 → "1 hour", 30 → "30 min" */
export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!m) return h === 1 ? '1 hour' : `${h} hours`;
  return `${h} h ${m} min`;
}

/** Times every `step` minutes from 00:00; includes "24:00" when `includeMidnightEnd`. */
export function timeOptions(step = 30, includeMidnightEnd = false): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += step) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  if (includeMidnightEnd) out.push('24:00');
  return out;
}
