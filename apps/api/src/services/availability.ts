import { addDays, addMinutes, format, parseISO } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { and, asc, eq, gt, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import {
  bookings,
  businesses,
  resourceServices,
  resources,
  services,
  timeOff,
  workingHours,
  type Db,
  type Tx,
} from '@outletbooking/db';
import type { Availability, AvailabilityQuery } from '@outletbooking/shared';
import { AppError, notFound } from '../errors';

type Q = Db | Tx;

export interface Interval {
  start: Date;
  end: Date;
}

/** Statuses that hold a resource (same as the `bookings_no_overlap` constraint). */
export const ACTIVE_BOOKING_STATUSES = ['pending', 'confirmed', 'checked_in'] as const;

export interface BookingRules {
  timezone: string;
  slotIntervalMin: number;
  minAdvanceMin: number;
  maxDaysAhead: number;
}

export interface ServiceTiming {
  durationMin: number;
  /** Cleanup time after the booking. */
  bufferMin: number;
  /** Travel time before and after (location-based services). */
  travelBufferMin: number;
}

export interface ResourceSchedule {
  id: number;
  /** Local "HH:MM" (or "HH:MM:SS"); several rows on one weekday = breaks in between. "24:00" = midnight. */
  hours: { weekday: number; startTime: string; endTime: string }[];
  /** Resource time off plus business-wide closures. */
  timeOff: Interval[];
  /** Blocked ranges of the resource's active bookings. */
  busy: Interval[];
}

export interface SlotInput {
  /** Local date "YYYY-MM-DD" in rules.timezone. */
  date: string;
  now: Date;
  rules: BookingRules;
  timing: ServiceTiming;
  /** In display order (sort order); used as the tie-break for "any available". */
  resources: ResourceSchedule[];
  /** Owner/staff bookings: skip advance notice and max days ahead. */
  ignoreBookingWindow?: boolean;
}

export interface Slot {
  start: Date;
  end: Date;
  resourceIds: number[];
}

/**
 * The time a booking really holds the resource: travel before, cleanup + travel after (BR-02).
 * Booking creation must store exactly this as blocked_start_at / blocked_end_at.
 */
export function blockedRange(start: Date, end: Date, timing: Omit<ServiceTiming, 'durationMin'>): Interval {
  return {
    start: addMinutes(start, -timing.travelBufferMin),
    end: addMinutes(end, timing.bufferMin + timing.travelBufferMin),
  };
}

/** Durations a customer may pick for a service. */
export function allowedDurations(service: { durationMin: number; durationOptions: number[] | null }): number[] {
  return service.durationOptions?.length ? service.durationOptions : [service.durationMin];
}

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const nextDate = (date: string) => format(addDays(parseISO(date), 1), 'yyyy-MM-dd');

/** Local wall-clock (date + minutes since midnight, 1440 = end of day) → UTC instant. */
export function localToUtc(date: string, minutes: number, timezone: string): Date {
  if (minutes >= 1440) return fromZonedTime(`${nextDate(date)}T00:00:00`, timezone);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return fromZonedTime(`${date}T${hh}:${mm}:00`, timezone);
}

/** UTC range of a whole local day. */
export function localDayRange(date: string, timezone: string): Interval {
  return { start: localToUtc(date, 0, timezone), end: localToUtc(date, 1440, timezone) };
}

/** BR-03: today … today + max days ahead (local dates). */
export function isWithinBookingWindow(date: string, now: Date, rules: BookingRules): boolean {
  const today = formatInTimeZone(now, rules.timezone, 'yyyy-MM-dd');
  const last = format(addDays(parseISO(today), rules.maxDaysAhead), 'yyyy-MM-dd');
  return date >= today && date <= last;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

function overlapMinutes(a: Interval, b: Interval): number {
  const ms = Math.min(a.end.getTime(), b.end.getTime()) - Math.max(a.start.getTime(), b.start.getTime());
  return ms > 0 ? ms / 60_000 : 0;
}

/**
 * Pure slot calculation (FR-06.1/06.2). A slot is offered on a resource when:
 * - the shown time (start … start + duration) fits inside one working-hours window that day
 *   (gaps between windows are breaks) and does not touch time off;
 * - its blocked range (with buffers) does not overlap any active booking's blocked range —
 *   the same rule the database exclusion constraint enforces;
 * - it starts at least `minAdvanceMin` from now, on a date within the booking window.
 * Slot starts step by `slotIntervalMin` from the start of each working window.
 */
export function computeSlots(input: SlotInput): Slot[] {
  const { date, now, rules, timing } = input;
  if (!input.ignoreBookingWindow && !isWithinBookingWindow(date, now, rules)) return [];

  const earliest = input.ignoreBookingWindow ? null : addMinutes(now, rules.minAdvanceMin);
  const weekday = parseISO(date).getDay();
  const day = localDayRange(date, rules.timezone);
  const step = rules.slotIntervalMin;
  const bySlot = new Map<number, { slot: Slot; load: Map<number, number> }>();

  input.resources.forEach((res) => {
    const load = res.busy.reduce((sum, b) => sum + overlapMinutes(b, day), 0);
    const windows = res.hours
      .filter((h) => h.weekday === weekday)
      .map((h) => ({ from: toMinutes(h.startTime), to: toMinutes(h.endTime) }))
      .sort((a, b) => a.from - b.from);

    for (const w of windows) {
      for (let m = w.from; m + timing.durationMin <= w.to; m += step) {
        const shown = {
          start: localToUtc(date, m, rules.timezone),
          end: localToUtc(date, m + timing.durationMin, rules.timezone),
        };
        if (earliest && shown.start < earliest) continue;
        if (res.timeOff.some((t) => overlaps(t, shown))) continue;
        const blocked = blockedRange(shown.start, shown.end, timing);
        if (res.busy.some((b) => overlaps(b, blocked))) continue;

        const key = shown.start.getTime();
        const entry = bySlot.get(key) ?? { slot: { ...shown, resourceIds: [] as number[] }, load: new Map<number, number>() };
        if (!entry.slot.resourceIds.includes(res.id)) {
          entry.slot.resourceIds.push(res.id);
          entry.load.set(res.id, load);
        }
        bySlot.set(key, entry);
      }
    }
  });

  return [...bySlot.values()]
    .sort((a, b) => a.slot.start.getTime() - b.slot.start.getTime())
    .map(({ slot, load }) => ({
      ...slot,
      // Stable sort: equal load keeps resource display order.
      resourceIds: [...slot.resourceIds].sort((a, b) => load.get(a)! - load.get(b)!),
    }));
}

export interface AvailabilityOptions {
  now?: Date;
  /** Owner/staff calendar: skip advance notice and max days ahead. */
  ignoreBookingWindow?: boolean;
  /** Rescheduling: the booking being moved must not block itself. */
  excludeBookingId?: number;
}

/** Active, not archived resources linked to the service, in display order. */
export async function offeredResourceIds(q: Q, businessId: number, serviceId: number): Promise<number[]> {
  const rows = await q
    .select({ id: resources.id })
    .from(resourceServices)
    .innerJoin(
      resources,
      and(eq(resources.businessId, resourceServices.businessId), eq(resources.id, resourceServices.resourceId)),
    )
    .where(
      and(
        eq(resourceServices.businessId, businessId),
        eq(resourceServices.serviceId, serviceId),
        eq(resources.isActive, true),
        isNull(resources.deletedAt),
      ),
    )
    .orderBy(asc(resources.sortOrder), asc(resources.id));
  return rows.map((r) => r.id);
}

/** Loads the business's schedule data and returns the free slots for one service on one local date. */
export async function getAvailability(
  q: Q,
  businessId: number,
  query: AvailabilityQuery,
  opts: AvailabilityOptions = {},
): Promise<Availability> {
  const [biz] = await q
    .select({
      timezone: businesses.timezone,
      slotIntervalMin: businesses.slotIntervalMin,
      minAdvanceMin: businesses.minAdvanceMin,
      maxDaysAhead: businesses.maxDaysAhead,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId));
  if (!biz) throw notFound('Business');

  const [service] = await q
    .select({
      durationMin: services.durationMin,
      durationOptions: services.durationOptions,
      bufferMin: services.bufferMin,
      travelBufferMin: services.travelBufferMin,
    })
    .from(services)
    .where(and(eq(services.businessId, businessId), eq(services.id, query.serviceId), isNull(services.deletedAt)));
  if (!service) throw notFound('Service');

  const durationMin = query.durationMin ?? service.durationMin;
  if (!allowedDurations(service).includes(durationMin)) {
    throw new AppError(400, 'invalid_duration', 'This duration is not offered for the service');
  }

  let resourceIds = await offeredResourceIds(q, businessId, query.serviceId);
  if (query.resourceId !== undefined) {
    if (!resourceIds.includes(query.resourceId)) throw notFound('Resource');
    resourceIds = [query.resourceId];
  }

  const result: Availability = { date: query.date, timezone: biz.timezone, durationMin, slots: [] };
  if (!resourceIds.length) return result;

  const day = localDayRange(query.date, biz.timezone);
  const schedules = await loadSchedules(q, businessId, resourceIds, day, opts.excludeBookingId);
  const slots = computeSlots({
    date: query.date,
    now: opts.now ?? new Date(),
    rules: biz,
    timing: { durationMin, bufferMin: service.bufferMin, travelBufferMin: service.travelBufferMin },
    ignoreBookingWindow: opts.ignoreBookingWindow,
    resources: schedules,
  });

  result.slots = slots.map((s) => ({
    startAt: s.start.toISOString(),
    endAt: s.end.toISOString(),
    resourceIds: s.resourceIds,
  }));
  return result;
}

/**
 * Working hours, time off and active bookings of these resources around one local day.
 * The range is widened by a day each side to catch neighbouring bookings whose buffers spill over.
 */
export async function loadSchedules(
  q: Q,
  businessId: number,
  resourceIds: number[],
  day: Interval,
  excludeBookingId?: number,
): Promise<ResourceSchedule[]> {
  const from = addDays(day.start, -1);
  const to = addDays(day.end, 1);

  const [hours, offs, busy] = await Promise.all([
    q
      .select({
        resourceId: workingHours.resourceId,
        weekday: workingHours.weekday,
        startTime: workingHours.startTime,
        endTime: workingHours.endTime,
      })
      .from(workingHours)
      .where(and(eq(workingHours.businessId, businessId), inArray(workingHours.resourceId, resourceIds))),
    q
      .select({ resourceId: timeOff.resourceId, start: timeOff.startAt, end: timeOff.endAt })
      .from(timeOff)
      .where(
        and(
          eq(timeOff.businessId, businessId),
          or(isNull(timeOff.resourceId), inArray(timeOff.resourceId, resourceIds)),
          lt(timeOff.startAt, to),
          gt(timeOff.endAt, from),
        ),
      ),
    q
      .select({ resourceId: bookings.resourceId, start: bookings.blockedStartAt, end: bookings.blockedEndAt })
      .from(bookings)
      .where(
        and(
          eq(bookings.businessId, businessId),
          inArray(bookings.resourceId, resourceIds),
          inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]),
          lt(bookings.blockedStartAt, to),
          gt(bookings.blockedEndAt, from),
          excludeBookingId !== undefined ? ne(bookings.id, excludeBookingId) : undefined,
        ),
      ),
  ]);

  return resourceIds.map((id) => ({
    id,
    hours: hours.filter((h) => h.resourceId === id),
    timeOff: offs.filter((t) => t.resourceId === null || t.resourceId === id),
    busy: busy.filter((b) => b.resourceId === id),
  }));
}

export type UnbookableReason = 'outside_hours' | 'time_off' | 'slot_taken';

/**
 * Can this exact time be booked on this resource? Unlike computeSlots it does not need the
 * slot grid (owners may book 10:15). `allowOutsideHours` skips working hours and time off;
 * clashing bookings are always reported (and the database would reject them anyway).
 */
export function checkSchedule(
  res: ResourceSchedule,
  start: Date,
  timing: ServiceTiming,
  timezone: string,
  allowOutsideHours = false,
): UnbookableReason | null {
  const shown = { start, end: addMinutes(start, timing.durationMin) };
  if (!allowOutsideHours) {
    const weekday = Number(formatInTimeZone(start, timezone, 'i')) % 7;
    const from = toMinutes(formatInTimeZone(start, timezone, 'HH:mm'));
    const to = from + timing.durationMin;
    const fits = res.hours.some(
      (h) => h.weekday === weekday && toMinutes(h.startTime) <= from && to <= toMinutes(h.endTime),
    );
    if (!fits) return 'outside_hours';
    if (res.timeOff.some((t) => overlaps(t, shown))) return 'time_off';
  }
  const blocked = blockedRange(shown.start, shown.end, timing);
  if (res.busy.some((b) => overlaps(b, blocked))) return 'slot_taken';
  return null;
}

const UNBOOKABLE_MESSAGES: Record<UnbookableReason, string> = {
  outside_hours: 'This time is outside working hours',
  time_off: 'This time is blocked by time off or a closure',
  slot_taken: 'This time was just taken. Please pick another slot.',
};

export const unbookable = (reason: UnbookableReason) =>
  new AppError(409, reason, UNBOOKABLE_MESSAGES[reason]);

/** Loads one resource's schedule around `start` and throws 409 if the time cannot be booked. */
export async function assertBookable(
  q: Q,
  businessId: number,
  input: {
    resourceId: number;
    start: Date;
    timing: ServiceTiming;
    timezone: string;
    allowOutsideHours?: boolean;
    excludeBookingId?: number;
  },
): Promise<void> {
  const date = formatInTimeZone(input.start, input.timezone, 'yyyy-MM-dd');
  const [schedule] = await loadSchedules(
    q,
    businessId,
    [input.resourceId],
    localDayRange(date, input.timezone),
    input.excludeBookingId,
  );
  const reason = checkSchedule(schedule!, input.start, input.timing, input.timezone, input.allowOutsideHours);
  if (reason) throw unbookable(reason);
}
