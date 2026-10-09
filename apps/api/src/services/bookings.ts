import { addMinutes } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, like, lt, notInArray, or, sql, type SQL } from 'drizzle-orm';
import {
  bookingFields,
  bookings,
  businesses,
  customers,
  payments,
  refunds,
  resources,
  services,
  type Db,
  type Tx,
} from '@outletbooking/db';
import {
  canTransition,
  STAFF_STATUS_CHANGES,
  type Booking,
  type BookingCreate,
  type BookingExtend,
  type BookingListQuery,
  type BookingReschedule,
  type BookingSearchQuery,
  type BookingSource,
  type BookingStatus,
  type BookingStatusChange,
  type BookingUpdate,
  type MemberRole,
  type PaymentStatus,
  type RefundInput,
} from '@outletbooking/shared';
import { AppError, forbidden, notFound, pgErrorInfo } from '../errors';
import {
  ACTIVE_BOOKING_STATUSES,
  allowedDurations,
  assertBookable,
  blockedRange,
  checkSchedule,
  loadSchedules,
  localDayRange,
  offeredResourceIds,
  unbookable,
  type ServiceTiming,
} from './availability';
import { recordBookingEvent, STATUS_EVENT } from './booking-events';
import { getPriceQuote } from './pricing';
import { resourceScope } from './resources';
import type { Tenant } from '../types';

type Q = Db | Tx;

/**
 * What a member may see. Staff without "view all" only see bookings on resources linked to
 * their login; staff who cannot change setup don't see answers to questions hidden from staff.
 */
export interface BookingScope {
  linkedUserId?: number;
  hiddenFieldKeys?: string[];
}

/** Booking-question keys hidden from this member (none for owners and setup editors). */
export async function hiddenFieldKeys(q: Q, tenant: Tenant): Promise<string[]> {
  if (tenant.canEditSetup) return [];
  const rows = await q
    .selectDistinct({ key: bookingFields.fieldKey })
    .from(bookingFields)
    .where(and(eq(bookingFields.businessId, tenant.businessId), eq(bookingFields.showToStaff, false)));
  return rows.map((r) => r.key);
}

/** Scope for booking routes, resolved from the tenant (never from the client). */
export async function bookingScope(q: Q, tenant: Tenant, userId: number): Promise<BookingScope> {
  return { ...resourceScope(tenant, userId), hiddenFieldKeys: await hiddenFieldKeys(q, tenant) };
}

const columns = {
  id: bookings.id,
  status: bookings.status,
  source: bookings.source,
  startAt: bookings.startAt,
  endAt: bookings.endAt,
  durationMin: bookings.durationMin,
  resourceId: resources.id,
  resourceName: resources.name,
  serviceId: services.id,
  serviceName: services.name,
  customerId: customers.id,
  customerName: customers.name,
  customerPhone: customers.phone,
  customerEmail: customers.email,
  priceSen: bookings.priceSen,
  amountDueSen: bookings.amountDueSen,
  paymentStatus: bookings.paymentStatus,
  locationAddress: bookings.locationAddress,
  customFields: bookings.customFields,
  customerNotes: bookings.customerNotes,
  internalNotes: bookings.internalNotes,
  resultNotes: bookings.resultNotes,
  cancelReason: bookings.cancelReason,
  checkedInAt: bookings.checkedInAt,
  completedAt: bookings.completedAt,
  travelBufferMin: services.travelBufferMin,
  createdAt: bookings.createdAt,
  expiresAt: bookings.expiresAt,
  reminderSentAt: bookings.reminderSentAt,
  paidSen: sql<number>`(select coalesce(sum(${payments.amountSen}), 0)::int from ${payments}
    where ${payments.businessId} = ${bookings.businessId} and ${payments.bookingId} = ${bookings.id} and ${payments.status} = 'paid')`,
  refundedSen: sql<number>`(select coalesce(sum(${refunds.amountSen}), 0)::int from ${refunds}
    where ${refunds.businessId} = ${bookings.businessId} and ${refunds.bookingId} = ${bookings.id})`,
};

function selectBookings(q: Q) {
  return q
    .select(columns)
    .from(bookings)
    .innerJoin(resources, and(eq(resources.businessId, bookings.businessId), eq(resources.id, bookings.resourceId)))
    .innerJoin(services, and(eq(services.businessId, bookings.businessId), eq(services.id, bookings.serviceId)))
    .innerJoin(customers, and(eq(customers.businessId, bookings.businessId), eq(customers.id, bookings.customerId)));
}

type Row = Awaited<ReturnType<ReturnType<typeof selectBookings>['execute']>>[number];

const toDto = (r: Row, scope: BookingScope = {}): Booking => ({
  id: r.id,
  status: r.status as BookingStatus,
  source: r.source as BookingSource,
  startAt: r.startAt.toISOString(),
  endAt: r.endAt.toISOString(),
  durationMin: r.durationMin,
  resource: { id: r.resourceId, name: r.resourceName },
  service: { id: r.serviceId, name: r.serviceName },
  customer: { id: r.customerId, name: r.customerName, phone: r.customerPhone, email: r.customerEmail },
  priceSen: r.priceSen,
  amountDueSen: r.amountDueSen,
  paymentStatus: r.paymentStatus as PaymentStatus,
  paidSen: Number(r.paidSen),
  refundedSen: Number(r.refundedSen),
  expiresAt: r.expiresAt?.toISOString() ?? null,
  reminderSentAt: r.reminderSentAt?.toISOString() ?? null,
  locationAddress: r.locationAddress,
  customFields: withoutKeys(r.customFields as Record<string, string | number>, scope.hiddenFieldKeys),
  customerNotes: r.customerNotes,
  internalNotes: r.internalNotes,
  resultNotes: r.resultNotes,
  cancelReason: r.cancelReason,
  checkedInAt: r.checkedInAt?.toISOString() ?? null,
  completedAt: r.completedAt?.toISOString() ?? null,
  travelBufferMin: r.travelBufferMin,
  createdAt: r.createdAt.toISOString(),
});

function withoutKeys<T>(obj: Record<string, T>, keys: string[] | undefined): Record<string, T> {
  if (!keys?.length) return obj;
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
}

const scopeFilter = (scope: BookingScope): SQL | undefined =>
  scope.linkedUserId !== undefined ? eq(resources.userId, scope.linkedUserId) : undefined;

async function businessTimezone(q: Q, businessId: number): Promise<string> {
  const [biz] = await q.select({ timezone: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId));
  if (!biz) throw notFound('Business');
  return biz.timezone;
}

/** Calendar: bookings overlapping the local dates [from, to). Cancelled / no-show only on request. */
export async function listBookings(
  q: Q,
  businessId: number,
  query: BookingListQuery,
  scope: BookingScope = {},
): Promise<Booking[]> {
  const tz = await businessTimezone(q, businessId);
  const from = localDayRange(query.from, tz).start;
  const to = localDayRange(query.to, tz).start;
  const rows = await selectBookings(q)
    .where(
      and(
        eq(bookings.businessId, businessId),
        lt(bookings.startAt, to),
        gt(bookings.endAt, from),
        query.resourceId !== undefined ? eq(bookings.resourceId, query.resourceId) : undefined,
        query.includeInactive ? undefined : inArray(bookings.status, ['pending', 'confirmed', 'checked_in', 'completed']),
        scopeFilter(scope),
      ),
    )
    .orderBy(asc(bookings.startAt), asc(resources.sortOrder), asc(bookings.id));
  return rows.map((r) => toDto(r, scope));
}

/** Treat % _ \ typed by the user as plain characters in LIKE patterns. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** O9 search: customer name, phone digits, or a searchable booking answer (spaces ignored, "WXY1234" = "WXY 1234"). */
async function searchCondition(q: Q, businessId: number, term: string, hidden: string[] = []): Promise<SQL | undefined> {
  const fields = await q
    .selectDistinct({ key: bookingFields.fieldKey })
    .from(bookingFields)
    .where(
      and(
        eq(bookingFields.businessId, businessId),
        eq(bookingFields.isSearchable, true),
        hidden.length ? notInArray(bookingFields.fieldKey, hidden) : undefined,
      ),
    );
  const compact = `%${escapeLike(term.replace(/\s+/g, ''))}%`;
  const conds: SQL[] = [ilike(customers.name, `%${escapeLike(term)}%`)];
  // Phone-looking input only ("012-345 6789", "+60 12…") → match the stored +60123456789.
  // Mixed input like a plate number "WXY1234" must not match phones containing 1234.
  const digits = term.replace(/\D/g, '').replace(/^0/, '');
  if (/^[\d\s+()-]+$/.test(term) && digits.length >= 3) conds.push(like(customers.phone, `%${digits}%`));
  for (const { key } of fields) {
    conds.push(sql`replace(${bookings.customFields} ->> ${key}, ' ', '') ilike ${compact}`);
  }
  return or(...conds);
}

const FINAL_STATUSES = ['completed', 'cancelled', 'no_show'] as const;

export async function searchBookings(
  q: Q,
  businessId: number,
  query: BookingSearchQuery,
  scope: BookingScope = {},
  now = new Date(),
): Promise<Booking[]> {
  const where: (SQL | undefined)[] = [eq(bookings.businessId, businessId), scopeFilter(scope)];
  if (query.q) where.push(await searchCondition(q, businessId, query.q, scope.hiddenFieldKeys));

  const upcoming = gte(bookings.endAt, now);
  let order: SQL[];
  switch (query.filter) {
    case 'upcoming':
      where.push(upcoming, notInArray(bookings.status, ['cancelled', 'no_show']));
      order = [asc(bookings.startAt)];
      break;
    case 'unpaid':
      where.push(eq(bookings.paymentStatus, 'unpaid'), notInArray(bookings.status, ['cancelled', 'no_show']));
      order = [asc(bookings.startAt)];
      break;
    case 'past':
      where.push(or(lt(bookings.endAt, now), inArray(bookings.status, [...FINAL_STATUSES])));
      order = [desc(bookings.startAt)];
      break;
    default:
      // Upcoming (soonest first), then past (most recent first).
      // Raw SQL params are not mapped like column comparisons: pass the instant as text.
      const at = sql`${now.toISOString()}::timestamptz`;
      order = [
        sql`${bookings.endAt} < ${at}`,
        sql`case when ${bookings.endAt} >= ${at} then ${bookings.startAt} end asc`,
        desc(bookings.startAt),
      ];
  }

  const rows = await selectBookings(q)
    .where(and(...where))
    .orderBy(...order, desc(bookings.id))
    .limit(query.limit);
  return rows.map((r) => toDto(r, scope));
}

export async function getBooking(q: Q, businessId: number, id: number, scope: BookingScope = {}): Promise<Booking> {
  const [row] = await selectBookings(q).where(
    and(eq(bookings.businessId, businessId), eq(bookings.id, id), scopeFilter(scope)),
  );
  if (!row) throw notFound('Booking');
  return toDto(row, scope);
}

/** Service timing + allowed durations, or 404 for archived / other businesses' services. */
async function loadService(q: Q, businessId: number, serviceId: number) {
  const [svc] = await q
    .select({
      durationMin: services.durationMin,
      durationOptions: services.durationOptions,
      bufferMin: services.bufferMin,
      travelBufferMin: services.travelBufferMin,
    })
    .from(services)
    .where(and(eq(services.businessId, businessId), eq(services.id, serviceId), isNull(services.deletedAt)));
  if (!svc) throw notFound('Service');
  return svc;
}

function timingFor(svc: Awaited<ReturnType<typeof loadService>>, durationMin: number): ServiceTiming {
  if (!allowedDurations(svc).includes(durationMin)) {
    throw new AppError(400, 'invalid_duration', 'This duration is not offered for the service');
  }
  return { durationMin, bufferMin: svc.bufferMin, travelBufferMin: svc.travelBufferMin };
}

/**
 * Answers must match the business's active booking questions (for this service or all services).
 * Customers (public page) must also answer the required ones; owners may leave them blank.
 */
export async function assertCustomFields(
  q: Q,
  businessId: number,
  serviceId: number,
  values: Record<string, string | number>,
  opts: { enforceRequired?: boolean } = {},
) {
  const keys = Object.keys(values);
  if (!keys.length && !opts.enforceRequired) return;
  const defs = await q
    .select({
      key: bookingFields.fieldKey,
      label: bookingFields.label,
      type: bookingFields.fieldType,
      options: bookingFields.options,
      isRequired: bookingFields.isRequired,
    })
    .from(bookingFields)
    .where(
      and(
        eq(bookingFields.businessId, businessId),
        eq(bookingFields.isActive, true),
        or(isNull(bookingFields.serviceId), eq(bookingFields.serviceId, serviceId)),
      ),
    );
  const byKey = new Map(defs.map((d) => [d.key, d]));
  for (const key of keys) {
    const def = byKey.get(key);
    const value = values[key]!;
    const bad =
      !def ||
      (def.type === 'number' ? typeof value !== 'number' : typeof value !== 'string') ||
      (def.type === 'select' && !(def.options ?? []).includes(String(value)));
    if (bad) {
      throw new AppError(400, 'invalid_custom_fields', `Invalid answer for "${key}"`, { field: key });
    }
  }
  if (opts.enforceRequired) {
    const missing = defs.find((d) => d.isRequired && (values[d.key] === undefined || values[d.key] === ''));
    if (missing) {
      throw new AppError(400, 'missing_custom_fields', `Please answer "${missing.label}"`, { field: missing.key });
    }
  }
}

/** Free resource with the least booked time that day (FR-06.5), or 409. */
async function pickResource(q: Q, businessId: number, serviceId: number, start: Date, timing: ServiceTiming, tz: string, allowOutsideHours: boolean) {
  const ids = await offeredResourceIds(q, businessId, serviceId);
  if (!ids.length) throw unbookable('slot_taken');
  const day = localDayRange(formatInTimeZone(start, tz, 'yyyy-MM-dd'), tz);
  const schedules = await loadSchedules(q, businessId, ids, day);
  const load = (busy: { start: Date; end: Date }[]) =>
    busy.reduce((sum, b) => sum + Math.max(0, Math.min(+b.end, +day.end) - Math.max(+b.start, +day.start)), 0);
  const free = schedules
    .filter((s) => checkSchedule(s, start, timing, tz, allowOutsideHours) === null)
    .sort((a, b) => load(a.busy) - load(b.busy));
  if (!free.length) throw unbookable('slot_taken');
  return free[0]!.id;
}

export async function resourceBranch(q: Q, businessId: number, resourceId: number) {
  const [r] = await q
    .select({ branchId: resources.branchId })
    .from(resources)
    .where(and(eq(resources.businessId, businessId), eq(resources.id, resourceId)));
  return r?.branchId ?? null;
}

/** The exclusion constraint is the final guard against double booking; turn it into a friendly 409. */
export async function guardOverlap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (pgErrorInfo(err).code === '23P01') throw unbookable('slot_taken');
    throw err;
  }
}

/**
 * Customer identity per business = phone (BR-06). Re-activates an archived customer.
 * `overwrite` (owner/staff) updates the stored name/email; the public page never does, so a
 * stranger who knows a phone number cannot rename someone else's customer record.
 */
export async function upsertCustomer(
  q: Q,
  businessId: number,
  c: { name: string; phone: string; email?: string | null },
  opts: { overwrite: boolean },
): Promise<{ id: number }> {
  const [row] = await q
    .insert(customers)
    .values({ businessId, name: c.name, phone: c.phone, email: c.email ?? null })
    .onConflictDoUpdate({
      target: [customers.businessId, customers.phone],
      set: opts.overwrite
        ? { name: sql`excluded.name`, email: sql`coalesce(excluded.email, ${customers.email})`, deletedAt: null }
        : { deletedAt: null },
    })
    .returning({ id: customers.id });
  return row!;
}

/** Owner calendar / walk-in booking. Created as confirmed; payment due (if any) is collected separately. */
export async function createBooking(db: Db, businessId: number, userId: number, input: BookingCreate): Promise<Booking> {
  return db.transaction(async (tx) => {
    const tz = await businessTimezone(tx, businessId);
    const svc = await loadService(tx, businessId, input.serviceId);
    const timing = timingFor(svc, input.durationMin ?? svc.durationMin);

    let resourceId = input.resourceId;
    if (resourceId !== undefined) {
      if (!(await offeredResourceIds(tx, businessId, input.serviceId)).includes(resourceId)) throw notFound('Resource');
      await assertBookable(tx, businessId, {
        resourceId,
        start: input.startAt,
        timing,
        timezone: tz,
        allowOutsideHours: input.allowOutsideHours,
      });
    } else {
      resourceId = await pickResource(tx, businessId, input.serviceId, input.startAt, timing, tz, input.allowOutsideHours);
    }

    if (input.customFields) await assertCustomFields(tx, businessId, input.serviceId, input.customFields);
    const quote = await getPriceQuote(tx, businessId, {
      serviceId: input.serviceId,
      startAt: input.startAt,
      durationMin: timing.durationMin,
    });

    const customer = await upsertCustomer(tx, businessId, input.customer, { overwrite: true });

    const endAt = addMinutes(input.startAt, timing.durationMin);
    const blocked = blockedRange(input.startAt, endAt, timing);
    const now = new Date();
    const branchId = await resourceBranch(tx, businessId, resourceId);
    const [row] = await guardOverlap(() =>
      tx
        .insert(bookings)
        .values({
          businessId,
          branchId,
          resourceId: resourceId!,
          serviceId: input.serviceId,
          customerId: customer.id,
          startAt: input.startAt,
          endAt,
          blockedStartAt: blocked.start,
          blockedEndAt: blocked.end,
          durationMin: timing.durationMin,
          status: 'confirmed',
          confirmedAt: now,
          source: input.source,
          priceSen: quote.priceSen,
          amountDueSen: quote.amountDueSen,
          paymentStatus: quote.paymentStatus,
          locationAddress: input.locationAddress ?? null,
          customFields: input.customFields ?? {},
          customerNotes: input.customerNotes ?? null,
          internalNotes: input.internalNotes ?? null,
          createdByUserId: userId,
        })
        .returning({ id: bookings.id }),
    );
    await recordBookingEvent(tx, {
      businessId,
      bookingId: row!.id,
      type: 'created',
      actorUserId: userId,
      details: { source: input.source, status: 'confirmed' },
    });
    return getBooking(tx, businessId, row!.id);
  });
}

async function lockBooking(tx: Tx, businessId: number, id: number) {
  const [row] = await tx
    .select({
      id: bookings.id,
      status: bookings.status,
      serviceId: bookings.serviceId,
      resourceId: bookings.resourceId,
      startAt: bookings.startAt,
      durationMin: bookings.durationMin,
      paymentStatus: bookings.paymentStatus,
      resourceUserId: resources.userId,
    })
    .from(bookings)
    .innerJoin(resources, and(eq(resources.businessId, bookings.businessId), eq(resources.id, bookings.resourceId)))
    .where(and(eq(bookings.businessId, businessId), eq(bookings.id, id)))
    .for('update', { of: bookings });
  if (!row) throw notFound('Booking');
  return row;
}

export async function updateBooking(db: Db, businessId: number, id: number, input: BookingUpdate): Promise<Booking> {
  return db.transaction(async (tx) => {
    const current = await lockBooking(tx, businessId, id);
    if (input.customFields) await assertCustomFields(tx, businessId, current.serviceId, input.customFields);
    if (Object.keys(input).length) {
      await tx.update(bookings).set(input).where(eq(bookings.id, id));
    }
    return getBooking(tx, businessId, id);
  });
}

/** FR-07.3: move to another time and/or resource. Re-priced unless already paid. */
export async function rescheduleBooking(
  db: Db,
  businessId: number,
  id: number,
  input: BookingReschedule,
  actorUserId: number,
): Promise<Booking> {
  return db.transaction(async (tx) => {
    const current = await lockBooking(tx, businessId, id);
    if (!(ACTIVE_BOOKING_STATUSES as readonly string[]).includes(current.status) || current.status === 'checked_in') {
      throw new AppError(409, 'not_reschedulable', 'Only pending or confirmed bookings can be rescheduled');
    }
    const tz = await businessTimezone(tx, businessId);
    const svc = await loadService(tx, businessId, current.serviceId);
    const timing = timingFor(svc, input.durationMin ?? current.durationMin);
    const resourceId = input.resourceId ?? current.resourceId;
    if (resourceId !== current.resourceId && !(await offeredResourceIds(tx, businessId, current.serviceId)).includes(resourceId)) {
      throw notFound('Resource');
    }
    await assertBookable(tx, businessId, {
      resourceId,
      start: input.startAt,
      timing,
      timezone: tz,
      allowOutsideHours: input.allowOutsideHours,
      excludeBookingId: id,
    });

    const endAt = addMinutes(input.startAt, timing.durationMin);
    const blocked = blockedRange(input.startAt, endAt, timing);
    const paid = current.paymentStatus === 'paid' || current.paymentStatus === 'refunded';
    const branchId = await resourceBranch(tx, businessId, resourceId);
    const quote = paid
      ? null
      : await getPriceQuote(tx, businessId, { serviceId: current.serviceId, startAt: input.startAt, durationMin: timing.durationMin });

    await guardOverlap(() =>
      tx
        .update(bookings)
        .set({
          resourceId,
          branchId,
          startAt: input.startAt,
          endAt,
          blockedStartAt: blocked.start,
          blockedEndAt: blocked.end,
          durationMin: timing.durationMin,
          ...(quote
            ? { priceSen: quote.priceSen, amountDueSen: quote.amountDueSen, paymentStatus: quote.paymentStatus }
            : {}),
        })
        .where(eq(bookings.id, id)),
    );
    await recordBookingEvent(tx, {
      businessId,
      bookingId: id,
      type: 'rescheduled',
      actorUserId,
      details: {
        from: { startAt: current.startAt.toISOString(), resourceId: current.resourceId, durationMin: current.durationMin },
        to: { startAt: input.startAt.toISOString(), resourceId, durationMin: timing.durationMin },
      },
    });
    return getBooking(tx, businessId, id);
  });
}

/**
 * H8 "Extend": add one block of the service duration to a confirmed / checked-in booking.
 * The new length must be one of the service's duration options. Re-priced unless already paid.
 */
export async function extendBooking(
  db: Db,
  businessId: number,
  id: number,
  input: BookingExtend,
  actorUserId: number,
): Promise<Booking> {
  return db.transaction(async (tx) => {
    const current = await lockBooking(tx, businessId, id);
    if (current.status !== 'confirmed' && current.status !== 'checked_in') {
      throw new AppError(409, 'not_extendable', 'Only confirmed or checked-in bookings can be extended');
    }
    const tz = await businessTimezone(tx, businessId);
    const svc = await loadService(tx, businessId, current.serviceId);
    const durationMin = current.durationMin + svc.durationMin;
    if (!allowedDurations(svc).includes(durationMin)) {
      throw new AppError(409, 'not_extendable', 'This booking is already at the longest length offered');
    }
    const timing = timingFor(svc, durationMin);
    await assertBookable(tx, businessId, {
      resourceId: current.resourceId,
      start: current.startAt,
      timing,
      timezone: tz,
      allowOutsideHours: input.allowOutsideHours,
      excludeBookingId: id,
    });

    const endAt = addMinutes(current.startAt, durationMin);
    const blocked = blockedRange(current.startAt, endAt, timing);
    const paid = current.paymentStatus === 'paid' || current.paymentStatus === 'refunded';
    const quote = await getPriceQuote(tx, businessId, { serviceId: current.serviceId, startAt: current.startAt, durationMin });
    await guardOverlap(() =>
      tx
        .update(bookings)
        .set({
          endAt,
          blockedStartAt: blocked.start,
          blockedEndAt: blocked.end,
          durationMin,
          priceSen: quote.priceSen,
          ...(paid ? {} : { amountDueSen: quote.amountDueSen, paymentStatus: quote.paymentStatus }),
        })
        .where(eq(bookings.id, id)),
    );
    await recordBookingEvent(tx, {
      businessId,
      bookingId: id,
      type: 'extended',
      actorUserId,
      details: { fromDurationMin: current.durationMin, toDurationMin: durationMin },
    });
    return getBooking(tx, businessId, id);
  });
}

export interface StatusActor {
  userId: number;
  role: MemberRole;
  scope: BookingScope;
}

const STATUS_TIMESTAMP: Partial<Record<BookingStatus, 'confirmedAt' | 'checkedInAt' | 'completedAt' | 'cancelledAt'>> = {
  confirmed: 'confirmedAt',
  checked_in: 'checkedInAt',
  completed: 'completedAt',
  cancelled: 'cancelledAt',
};

/** Status flow (see BOOKING_TRANSITIONS). Staff: check in / complete / no-show on their own bookings. */
export async function changeBookingStatus(
  db: Db,
  businessId: number,
  id: number,
  input: BookingStatusChange,
  actor: StatusActor,
): Promise<Booking> {
  return db.transaction(async (tx) => {
    const current = await lockBooking(tx, businessId, id);
    if (actor.scope.linkedUserId !== undefined && current.resourceUserId !== actor.scope.linkedUserId) {
      throw notFound('Booking');
    }
    if (actor.role !== 'owner' && !STAFF_STATUS_CHANGES.includes(input.status)) throw forbidden();
    const from = current.status as BookingStatus;
    if (!canTransition(from, input.status)) {
      throw new AppError(409, 'invalid_status_change', `A ${from.replace('_', ' ')} booking cannot become ${input.status.replace('_', ' ')}`);
    }
    const refundedAll = input.refund
      ? await recordRefund(tx, businessId, id, input.refund, actor.userId, input.reason)
      : false;
    const stamp = STATUS_TIMESTAMP[input.status];
    await tx
      .update(bookings)
      .set({
        status: input.status,
        ...(stamp ? { [stamp]: new Date() } : {}),
        ...(input.status === 'cancelled' ? { cancelReason: input.reason ?? null } : {}),
        ...(refundedAll ? { paymentStatus: 'refunded' } : {}),
      })
      .where(eq(bookings.id, id));
    await recordBookingEvent(tx, {
      businessId,
      bookingId: id,
      type: STATUS_EVENT[input.status as Exclude<BookingStatus, 'pending'>],
      actorUserId: actor.userId,
      details: {
        from,
        ...(input.status === 'cancelled' && input.reason ? { reason: input.reason } : {}),
      },
    });
    return getBooking(tx, businessId, id, actor.scope);
  });
}

/**
 * D4: record money paid back outside the app. At most what was paid minus earlier refunds.
 * Returns true when everything paid has now been refunded.
 */
async function recordRefund(
  tx: Tx,
  businessId: number,
  bookingId: number,
  refund: RefundInput,
  userId: number,
  reason: string | null | undefined,
): Promise<boolean> {
  const paidRows = await tx
    .select({ id: payments.id, amountSen: payments.amountSen })
    .from(payments)
    .where(and(eq(payments.businessId, businessId), eq(payments.bookingId, bookingId), eq(payments.status, 'paid')))
    .orderBy(desc(payments.id));
  const paidSen = paidRows.reduce((sum, p) => sum + p.amountSen, 0);
  const [prev] = await tx
    .select({ n: sql<number>`coalesce(sum(${refunds.amountSen}), 0)::int` })
    .from(refunds)
    .where(and(eq(refunds.businessId, businessId), eq(refunds.bookingId, bookingId)));
  const refundable = paidSen - Number(prev?.n ?? 0);
  if (refund.amountSen > refundable) {
    throw new AppError(
      400,
      'refund_too_large',
      refundable > 0 ? 'The refund is more than the customer paid' : 'Nothing has been paid for this booking',
    );
  }
  await tx.insert(refunds).values({
    businessId,
    bookingId,
    paymentId: paidRows[0]?.id ?? null,
    amountSen: refund.amountSen,
    method: refund.method,
    reason: reason ?? null,
    recordedByUserId: userId,
  });
  await recordBookingEvent(tx, {
    businessId,
    bookingId,
    type: 'refunded',
    actorUserId: userId,
    details: { amountSen: refund.amountSen, method: refund.method },
  });
  return refund.amountSen === refundable;
}
