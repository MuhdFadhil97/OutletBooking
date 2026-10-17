/**
 * The admin panel works in Malaysia time. A `<input type="datetime-local">` gives "2026-10-25T02:00" with no zone, so
 * read it as Malaysia time (UTC+8, no daylight saving) whatever the admin's computer is set to.
 */
export function malaysiaLocalToIso(local: string): string {
  return new Date(`${local.length === 16 ? `${local}:00` : local}+08:00`).toISOString();
}
