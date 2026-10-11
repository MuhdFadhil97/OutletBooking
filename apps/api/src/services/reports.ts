import { addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, format, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import { bookings, businesses, payments, refunds, resources, services, timeOff, workingHours, type Db } from '@outletbooking/db';
import {
  TOP_SERVICES_MAX,
  type Report,
  type ReportPeriod,
  type ReportUtilisation,
} from '@outletbooking/shared';
import { notFound } from '../errors';
import { localDayRange, localToUtc, type Interval } from './availability';

const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Local dates of a period (both inclusive). `offset` steps whole periods from the one containing `today`. */
export function periodRange(period: ReportPeriod, offset: number, today: string): { from: string; to: string } {
  const base = parseISO(today);
  if (period === 'today') {
    const d = ymd(addDays(base, offset));
    return { from: d, to: d };
  }
  if (period === 'week') {
    const monday = addWeeks(startOfWeek(base, { weekStartsOn: 1 }), offset);
    return { from: ymd(monday), to: ymd(addDays(monday, 6)) };
  }
  const first = addMonths(startOfMonth(base), offset);
  return { from: ymd(first), to: ymd(endOfMonth(first)) };
}

const datesBetween = (from: string, to: string) => eachDayOfInterval({ start: parseISO(from), end: parseISO(to) }).map(ymd);

/** `a` with the parts covered by `cuts` taken out. */
function subtract(a: Interval, cuts: Interval[]): Interval[] {
  let parts = [a];
  for (const c of cuts) {
    parts = parts.flatMap((p) => {
      if (c.end <= p.start || c.start >= p.end) return [p];
      const out: Interval[] = [];
      if (c.start > p.start) out.push({ start: p.start, end: c.start });
      if (c.end < p.end) out.push({ start: c.end, end: p.end });
      return out;
    });
  }
  return parts;
}

/** Overlapping intervals joined (no-shows are not in the overlap constraint, so bookings can overlap). */
function merge(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) {
      if (i.end > last.end) last.end = i.end;
    } else out.push({ ...i });
  }
  return out;
}

const minutes = (i: Interval) => (i.end.getTime() - i.start.getTime()) / 60_000;
function overlapMinutes(a: Interval, b: Interval): number {
  const ms = Math.min(a.end.getTime(), b.end.getTime()) - Math.max(a.start.getTime(), b.start.getTime());
  return ms > 0 ? ms / 60_000 : 0;
}
const rate = (part: number, whole: number) => (whole > 0 ? part / whole : null);

export interface UtilisationResource {
  id: number;
  hours: { weekday: number; startTime: string; endTime: string }[];
  /** Resource time off plus business-wide closures. */
  timeOff: Interval[];
  /** Shown time (start … end) of its bookings. */
  booked: Interval[];
}

/**
 * FR-13.3 (pure): open time = working hours on each local date minus time off;
 * booked time = bookings inside that open time (time outside opening hours is not counted).
 */
export function utilisation(dates: string[], timezone: string, res: UtilisationResource): ReportUtilisation {
  const booked = merge(res.booked);
  let openMin = 0;
  let bookedMin = 0;
  for (const date of dates) {
    const weekday = parseISO(date).getDay();
    for (const h of res.hours.filter((x) => x.weekday === weekday)) {
      const window = { start: localToUtc(date, toMinutes(h.startTime), timezone), end: localToUtc(date, toMinutes(h.endTime), timezone) };
      for (const open of subtract(window, res.timeOff)) {
        openMin += minutes(open);
        bookedMin += booked.reduce((sum, b) => sum + overlapMinutes(open, b), 0);
      }
    }
  }
  return { rate: rate(bookedMin, openMin), bookedMin: Math.round(bookedMin), openMin: Math.round(openMin) };
}

/** O8: numbers for one period of the business, compared with the period before. */
export async function getReport(
  db: Db,
  businessId: number,
  query: { period: ReportPeriod; offset: number },
  now = new Date(),
): Promise<Report> {
  const [biz] = await db.select({ timezone: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId));
  if (!biz) throw notFound('Business');
  const tz = biz.timezone;
  const today = formatInTimeZone(now, tz, 'yyyy-MM-dd');
  const { from, to } = periodRange(query.period, query.offset, today);
  const prev = periodRange(query.period, query.offset - 1, today);
  const range: Interval = { start: localDayRange(from, tz).start, end: localDayRange(to, tz).end };
  const prevStart = localDayRange(prev.from, tz).start;

  const [rows, activeResources, hours, offs, [collected], [refunded]] = await Promise.all([
    db
      .select({
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        status: bookings.status,
        priceSen: bookings.priceSen,
        serviceId: bookings.serviceId,
        resourceId: bookings.resourceId,
        customerId: bookings.customerId,
      })
      .from(bookings)
      .where(and(eq(bookings.businessId, businessId), gte(bookings.startAt, prevStart), lt(bookings.startAt, range.end))),
    db
      .select({ id: resources.id, name: resources.name })
      .from(resources)
      .where(and(eq(resources.businessId, businessId), eq(resources.isActive, true), isNull(resources.deletedAt)))
      .orderBy(asc(resources.sortOrder), asc(resources.id)),
    db
      .select({
        resourceId: workingHours.resourceId,
        weekday: workingHours.weekday,
        startTime: workingHours.startTime,
        endTime: workingHours.endTime,
      })
      .from(workingHours)
      .where(eq(workingHours.businessId, businessId)),
    db
      .select({ resourceId: timeOff.resourceId, start: timeOff.startAt, end: timeOff.endAt })
      .from(timeOff)
      .where(and(eq(timeOff.businessId, businessId), lt(timeOff.startAt, range.end), gt(timeOff.endAt, range.start))),
    db
      .select({ n: sql<number>`coalesce(sum(${payments.amountSen}), 0)::int` })
      .from(payments)
      .where(
        and(
          eq(payments.businessId, businessId),
          isNotNull(payments.bookingId),
          ne(payments.purpose, 'subscription'),
          eq(payments.status, 'paid'),
          gte(payments.paidAt, range.start),
          lt(payments.paidAt, range.end),
        ),
      ),
    db
      .select({ n: sql<number>`coalesce(sum(${refunds.amountSen}), 0)::int` })
      .from(refunds)
      .where(and(eq(refunds.businessId, businessId), gte(refunds.createdAt, range.start), lt(refunds.createdAt, range.end))),
  ]);

  const inPeriod = rows.filter((b) => b.startAt >= range.start);
  const counted = inPeriod.filter((b) => b.status !== 'cancelled');
  const prevCounted = rows.filter((b) => b.startAt < range.start && b.status !== 'cancelled');
  const value = (list: typeof rows) => list.filter((b) => b.status !== 'no_show').reduce((sum, b) => sum + b.priceSen, 0);
  const count = (status: string) => inPeriod.filter((b) => b.status === status).length;
  const noShows = count('no_show');

  // Bookings per day (local date of the start).
  const dates = datesBetween(from, to);
  const perDayMap = new Map(dates.map((d) => [d, 0]));
  for (const b of counted) {
    const d = formatInTimeZone(b.startAt, tz, 'yyyy-MM-dd');
    perDayMap.set(d, (perDayMap.get(d) ?? 0) + 1);
  }

  // Top services (names kept for archived services).
  const byService = new Map<number, number>();
  for (const b of counted) byService.set(b.serviceId, (byService.get(b.serviceId) ?? 0) + 1);
  const top = [...byService.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, TOP_SERVICES_MAX);
  const names = top.length
    ? await db
        .select({ id: services.id, name: services.name })
        .from(services)
        .where(and(eq(services.businessId, businessId), inArray(services.id, top.map(([id]) => id))))
    : [];

  // New vs returning: first non-cancelled booking ever falls in the period.
  const customerIds = [...new Set(counted.map((b) => b.customerId))];
  const firsts = customerIds.length
    ? await db
        .select({ customerId: bookings.customerId, first: sql<Date | string>`min(${bookings.startAt})` })
        .from(bookings)
        .where(and(eq(bookings.businessId, businessId), ne(bookings.status, 'cancelled'), inArray(bookings.customerId, customerIds)))
        .groupBy(bookings.customerId)
    : [];
  const newCustomers = firsts.filter((f) => new Date(f.first) >= range.start).length;

  // Utilisation of active resources.
  const perResource = activeResources.map((r) => ({
    id: r.id,
    name: r.name,
    ...utilisation(dates, tz, {
      id: r.id,
      hours: hours.filter((h) => h.resourceId === r.id),
      timeOff: offs.filter((o) => o.resourceId === null || o.resourceId === r.id),
      booked: counted.filter((b) => b.resourceId === r.id).map((b) => ({ start: b.startAt, end: b.endAt })),
    }),
  }));
  const openMin = perResource.reduce((sum, r) => sum + r.openMin, 0);
  const bookedMin = perResource.reduce((sum, r) => sum + r.bookedMin, 0);

  return {
    period: query.period,
    from,
    to,
    today,
    bookings: counted.length,
    prevBookings: prevCounted.length,
    revenueSen: value(counted),
    prevRevenueSen: value(prevCounted),
    collectedSen: Number(collected?.n ?? 0),
    refundedSen: Number(refunded?.n ?? 0),
    noShows,
    noShowRate: rate(noShows, counted.length),
    statuses: {
      upcoming: count('pending') + count('confirmed'),
      checkedIn: count('checked_in'),
      completed: count('completed'),
      noShow: noShows,
      cancelled: count('cancelled'),
    },
    utilisation: { rate: rate(bookedMin, openMin), bookedMin, openMin, resources: perResource },
    perDay: dates.map((date) => ({ date, bookings: perDayMap.get(date) ?? 0 })),
    topServices: top.map(([id, n]) => ({ id, name: names.find((s) => s.id === id)?.name ?? '', bookings: n })),
    customers: { new: newCustomers, returning: customerIds.length - newCustomers },
  };
}
