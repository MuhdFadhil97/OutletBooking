import { z } from 'zod';

/**
 * O8 reports (FR-13). Periods are local (business timezone): today, Monday–Sunday week, calendar month.
 * - Bookings: every booking starting in the period except cancelled ones (pending and no-shows count).
 * - Revenue: booked value — price of those bookings minus no-shows (same as Today's "expected revenue").
 * - Collected: payments received in the period minus refunds recorded in the period.
 * - No-show rate: no-shows ÷ bookings.
 * - Utilisation: booked time ÷ open time (working hours minus time off) of active resources.
 */

export const REPORT_PERIODS = ['today', 'week', 'month'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const reportQuery = z.object({
  period: z.enum(REPORT_PERIODS).default('week'),
  /** 0 = this period, -1 = the one before, 1 = the next one. */
  offset: z.coerce.number().int().min(-36).max(12).default(0),
});
export type ReportQuery = z.input<typeof reportQuery>;

/** How many top services the report lists. */
export const TOP_SERVICES_MAX = 5;

export interface ReportUtilisation {
  /** Booked ÷ open, 0…1; null when nothing was open. */
  rate: number | null;
  bookedMin: number;
  openMin: number;
}

export interface Report {
  period: ReportPeriod;
  /** Local dates "YYYY-MM-DD", both inclusive. */
  from: string;
  to: string;
  /** Today's local date, so the screen can mark days still to come. */
  today: string;
  bookings: number;
  prevBookings: number;
  revenueSen: number;
  prevRevenueSen: number;
  collectedSen: number;
  refundedSen: number;
  noShows: number;
  /** No-shows ÷ bookings, 0…1; null without bookings. */
  noShowRate: number | null;
  /** FR-13.1 today summary. */
  statuses: { upcoming: number; checkedIn: number; completed: number; noShow: number; cancelled: number };
  utilisation: ReportUtilisation & { resources: (ReportUtilisation & { id: number; name: string })[] };
  /** Every day of the period, in order. */
  perDay: { date: string; bookings: number }[];
  topServices: { id: number; name: string; bookings: number }[];
  /** FR-13.4: customers with a booking in the period; new = their first booking ever is in it. */
  customers: { new: number; returning: number };
}
