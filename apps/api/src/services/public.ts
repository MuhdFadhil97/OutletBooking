import { addMinutes } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { and, asc, count, eq, gt, inArray, isNull } from 'drizzle-orm';
import {
  bookingFields,
  bookings,
  businesses,
  customers,
  resources,
  resourceServices,
  services,
  type Db,
  type Tx,
} from '@outletbooking/db';
import type {
  Availability,
  AvailabilityQuery,
  BookingStatus,
  PriceQuote,
  PublicQuoteQuery,
  LocationType,
  PaymentStatus,
  PriceUnit,
  PublicBookingConfirmation,
  PublicBookingCreate,
  PublicBusiness,
  ResourceType,
} from '@outletbooking/shared';
import { AppError, notFound } from '../errors';
import { blockedRange, getAvailability, unbookable } from './availability';
import { assertCustomFields, guardOverlap, resourceBranch, upsertCustomer } from './bookings';
import { recordBookingEvent } from './booking-events';
import { getPriceQuote } from './pricing';

type Q = Db | Tx;

/** FR-08.7: at most this many active web bookings per phone per business in 24 hours. */
const MAX_WEB_BOOKINGS_PER_PHONE_PER_DAY = 5;

const businessColumns = {
  id: businesses.id,
  slug: businesses.slug,
  name: businesses.name,
  description: businesses.description,
  address: businesses.address,
  phone: businesses.phone,
  whatsappPhone: businesses.whatsappPhone,
  timezone: businesses.timezone,
  bookingEnabled: businesses.bookingEnabled,
  resourceLabel: businesses.resourceLabel,
  minAdvanceMin: businesses.minAdvanceMin,
  maxDaysAhead: businesses.maxDaysAhead,
  pendingExpiryMin: businesses.pendingExpiryMin,
  cancelCutoffMin: businesses.cancelCutoffMin,
};

async function findBusiness(q: Q, slug: string) {
  const [biz] = await q
    .select(businessColumns)
    .from(businesses)
    .where(and(eq(businesses.slug, slug), isNull(businesses.deletedAt)));
  if (!biz) throw notFound('Business');
  return biz;
}

function assertBookingOpen(biz: { bookingEnabled: boolean }) {
  if (!biz.bookingEnabled) {
    throw new AppError(403, 'booking_disabled', 'Online booking is paused. Please contact the business.');
  }
}

/** Hidden and archived services cannot be booked online (BR-08). */
async function visibleService(q: Q, businessId: number, serviceId: number) {
  const [svc] = await q
    .select({
      name: services.name,
      durationMin: services.durationMin,
      locationType: services.locationType,
      bufferMin: services.bufferMin,
      travelBufferMin: services.travelBufferMin,
    })
    .from(services)
    .where(
      and(
        eq(services.businessId, businessId),
        eq(services.id, serviceId),
        eq(services.isVisible, true),
        isNull(services.deletedAt),
      ),
    );
  if (!svc) throw notFound('Service');
  return svc;
}

/** Business info, visible services, bookable resources and booking questions for `/book/:slug`. */
export async function getPublicBusiness(db: Db, slug: string): Promise<PublicBusiness> {
  const { id, pendingExpiryMin: _p, ...info } = await findBusiness(db, slug);

  const svcRows = await db
    .select({
      id: services.id,
      name: services.name,
      description: services.description,
      durationMin: services.durationMin,
      durationOptions: services.durationOptions,
      priceUnit: services.priceUnit,
      priceSen: services.priceSen,
      depositSen: services.depositSen,
      prepayFull: services.prepayFull,
      locationType: services.locationType,
    })
    .from(services)
    .where(and(eq(services.businessId, id), eq(services.isVisible, true), isNull(services.deletedAt)))
    .orderBy(asc(services.sortOrder), asc(services.id));
  const serviceIds = svcRows.map((s) => s.id);

  const links = serviceIds.length
    ? await db
        .select({
          id: resources.id,
          name: resources.name,
          resourceType: resources.resourceType,
          serviceId: resourceServices.serviceId,
        })
        .from(resourceServices)
        .innerJoin(
          resources,
          and(eq(resources.businessId, resourceServices.businessId), eq(resources.id, resourceServices.resourceId)),
        )
        .where(
          and(
            eq(resourceServices.businessId, id),
            inArray(resourceServices.serviceId, serviceIds),
            eq(resources.isActive, true),
            isNull(resources.deletedAt),
          ),
        )
        .orderBy(asc(resources.sortOrder), asc(resources.id))
    : [];
  const byResource = new Map<number, PublicBusiness['resources'][number]>();
  for (const l of links) {
    const r = byResource.get(l.id) ?? { id: l.id, name: l.name, resourceType: l.resourceType as ResourceType, serviceIds: [] };
    r.serviceIds.push(l.serviceId);
    byResource.set(l.id, r);
  }

  const fields = await db
    .select({
      serviceId: bookingFields.serviceId,
      fieldKey: bookingFields.fieldKey,
      label: bookingFields.label,
      fieldType: bookingFields.fieldType,
      options: bookingFields.options,
      isRequired: bookingFields.isRequired,
      hint: bookingFields.hint,
    })
    .from(bookingFields)
    .where(and(eq(bookingFields.businessId, id), eq(bookingFields.isActive, true)))
    .orderBy(asc(bookingFields.sortOrder), asc(bookingFields.id));

  return {
    ...info,
    services: svcRows.map((s) => ({ ...s, priceUnit: s.priceUnit as PriceUnit, locationType: s.locationType as LocationType })),
    resources: [...byResource.values()],
    bookingFields: fields
      .filter((f) => f.serviceId === null || serviceIds.includes(f.serviceId))
      .map((f) => ({ ...f, fieldType: f.fieldType as PublicBusiness['bookingFields'][number]['fieldType'] })),
  };
}

/** Free slots for customers: booking window (advance notice, max days ahead) applies. */
export async function getPublicSlots(db: Db, slug: string, query: AvailabilityQuery, now = new Date()): Promise<Availability> {
  const biz = await findBusiness(db, slug);
  assertBookingOpen(biz);
  await visibleService(db, biz.id, query.serviceId);
  return getAvailability(db, biz.id, query, { now });
}

/**
 * Customer booking (FR-08). The start must be one of the offered slots, so working hours,
 * time off, buffers and the booking window all apply. Paid services start as `pending`
 * until payment (Phase 5) and expire after the business's pending_expiry_min.
 */
export async function createPublicBooking(
  db: Db,
  slug: string,
  input: PublicBookingCreate,
  now = new Date(),
): Promise<{ booking: PublicBookingConfirmation; id: number; businessId: number }> {
  return db.transaction(async (tx) => {
    const biz = await findBusiness(tx, slug);
    assertBookingOpen(biz);
    const svc = await visibleService(tx, biz.id, input.serviceId);
    if (svc.locationType === 'at_customer_location' && !input.locationAddress) {
      throw new AppError(400, 'address_required', 'Please enter the address');
    }
    const durationMin = input.durationMin ?? svc.durationMin;

    const date = formatInTimeZone(input.startAt, biz.timezone, 'yyyy-MM-dd');
    const availability = await getAvailability(
      tx,
      biz.id,
      { serviceId: input.serviceId, date, durationMin, resourceId: input.resourceId },
      { now },
    );
    const slot = availability.slots.find((s) => s.startAt === input.startAt.toISOString());
    if (!slot) throw unbookable('slot_taken');
    const resourceId = input.resourceId ?? slot.resourceIds[0]!;

    await assertCustomFields(tx, biz.id, input.serviceId, input.customFields ?? {}, { enforceRequired: true });

    const [recent] = await tx
      .select({ n: count() })
      .from(bookings)
      .innerJoin(customers, and(eq(customers.businessId, bookings.businessId), eq(customers.id, bookings.customerId)))
      .where(
        and(
          eq(bookings.businessId, biz.id),
          eq(customers.phone, input.customer.phone),
          eq(bookings.source, 'web'),
          inArray(bookings.status, ['pending', 'confirmed']),
          gt(bookings.createdAt, addMinutes(now, -24 * 60)),
        ),
      );
    if ((recent?.n ?? 0) >= MAX_WEB_BOOKINGS_PER_PHONE_PER_DAY) {
      throw new AppError(429, 'too_many_bookings', 'Too many bookings for this phone number today. Please contact the business.');
    }

    const quote = await getPriceQuote(tx, biz.id, { serviceId: input.serviceId, startAt: input.startAt, durationMin });
    const customer = await upsertCustomer(tx, biz.id, input.customer, { overwrite: false });

    const endAt = addMinutes(input.startAt, durationMin);
    const blocked = blockedRange(input.startAt, endAt, svc);
    const needsPayment = quote.amountDueSen > 0;
    const status: BookingStatus = needsPayment ? 'pending' : 'confirmed';
    const expiresAt = needsPayment ? addMinutes(now, biz.pendingExpiryMin) : null;
    const branchId = await resourceBranch(tx, biz.id, resourceId);

    const [row] = await guardOverlap(() =>
      tx
        .insert(bookings)
        .values({
          businessId: biz.id,
          branchId,
          resourceId,
          serviceId: input.serviceId,
          customerId: customer.id,
          startAt: input.startAt,
          endAt,
          blockedStartAt: blocked.start,
          blockedEndAt: blocked.end,
          durationMin,
          status,
          confirmedAt: needsPayment ? null : now,
          expiresAt,
          source: 'web',
          priceSen: quote.priceSen,
          amountDueSen: quote.amountDueSen,
          paymentStatus: quote.paymentStatus,
          locationAddress: input.locationAddress ?? null,
          customFields: input.customFields ?? {},
          customerNotes: input.customerNotes ?? null,
        })
        .returning({ id: bookings.id, token: bookings.publicToken }),
    );
    await recordBookingEvent(tx, {
      businessId: biz.id,
      bookingId: row!.id,
      type: 'created',
      actorUserId: null,
      details: { source: 'web', status },
    });

    const booking = await loadPublicBooking(tx, row!.token, now);
    // What the customer typed — never the name already stored for this phone.
    return { booking: { ...booking, customerName: input.customer.name }, id: row!.id, businessId: biz.id };
  });
}

/** Price for the details step (same engine as the booking itself). */
export async function getPublicQuote(db: Db, slug: string, query: PublicQuoteQuery): Promise<PriceQuote> {
  const biz = await findBusiness(db, slug);
  assertBookingOpen(biz);
  await visibleService(db, biz.id, query.serviceId);
  return getPriceQuote(db, biz.id, query);
}

const CUSTOMER_CANCELLABLE: readonly BookingStatus[] = ['pending', 'confirmed'];

/** FR-08.5: online cancel is allowed for pending/confirmed bookings until start − cancel_cutoff_min. */
function cancellableUntil(status: BookingStatus, startAt: Date, cutoffMin: number, now: Date): Date | null {
  if (!CUSTOMER_CANCELLABLE.includes(status)) return null;
  const until = addMinutes(startAt, -cutoffMin);
  return until > now ? until : null;
}

async function findByToken(q: Q, token: string, opts: { lock?: boolean } = {}) {
  const query = q
    .select({
      id: bookings.id,
      businessId: bookings.businessId,
      token: bookings.publicToken,
      status: bookings.status,
      startAt: bookings.startAt,
      endAt: bookings.endAt,
      durationMin: bookings.durationMin,
      locationAddress: bookings.locationAddress,
      priceSen: bookings.priceSen,
      amountDueSen: bookings.amountDueSen,
      paymentStatus: bookings.paymentStatus,
      expiresAt: bookings.expiresAt,
      serviceName: services.name,
      resourceName: resources.name,
      cancelCutoffMin: businesses.cancelCutoffMin,
      business: {
        slug: businesses.slug,
        name: businesses.name,
        address: businesses.address,
        phone: businesses.phone,
        whatsappPhone: businesses.whatsappPhone,
        timezone: businesses.timezone,
      },
    })
    .from(bookings)
    .innerJoin(businesses, eq(businesses.id, bookings.businessId))
    .innerJoin(services, and(eq(services.businessId, bookings.businessId), eq(services.id, bookings.serviceId)))
    .innerJoin(resources, and(eq(resources.businessId, bookings.businessId), eq(resources.id, bookings.resourceId)))
    .where(and(eq(bookings.publicToken, token), isNull(businesses.deletedAt)));
  const [row] = opts.lock ? await query.for('update', { of: bookings }) : await query;
  if (!row) throw notFound('Booking');
  return row;
}

async function loadPublicBooking(q: Q, token: string, now: Date): Promise<PublicBookingConfirmation> {
  const { id: _id, businessId: _b, cancelCutoffMin, ...b } = await findByToken(q, token);
  const status = b.status as BookingStatus;
  return {
    ...b,
    status,
    startAt: b.startAt.toISOString(),
    endAt: b.endAt.toISOString(),
    customerName: null,
    cancellableUntil: cancellableUntil(status, b.startAt, cancelCutoffMin, now)?.toISOString() ?? null,
    paymentStatus: b.paymentStatus as PaymentStatus,
    expiresAt: b.expiresAt?.toISOString() ?? null,
  };
}

/** Confirmation page (`/my-booking/:token`): only this booking, no customer details. */
export async function getPublicBooking(db: Db, token: string, now = new Date()): Promise<PublicBookingConfirmation> {
  return loadPublicBooking(db, token, now);
}

/** Customer cancels from the confirmation link (FR-08.5). */
export async function cancelPublicBooking(
  db: Db,
  token: string,
  now = new Date(),
): Promise<{ booking: PublicBookingConfirmation; id: number; businessId: number }> {
  return db.transaction(async (tx) => {
    const b = await findByToken(tx, token, { lock: true });
    if (b.status === 'cancelled') throw new AppError(409, 'already_cancelled', 'This booking is already cancelled');
    if (!cancellableUntil(b.status as BookingStatus, b.startAt, b.cancelCutoffMin, now)) {
      throw new AppError(409, 'cancel_closed', 'This booking can no longer be cancelled online. Please contact the business.');
    }
    await tx
      .update(bookings)
      .set({ status: 'cancelled', cancelledAt: now, cancelReason: 'Cancelled by customer' })
      .where(eq(bookings.id, b.id));
    return { booking: await loadPublicBooking(tx, token, now), id: b.id, businessId: b.businessId };
  });
}

/** iCalendar escaping (RFC 5545 §3.3.11). */
const icsText = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/[;,]/g, (m) => `\\${m}`)
    .replace(/\r?\n/g, '\\n');
const icsTime = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** "Add to calendar" file for the confirmation page. */
export function bookingIcs(b: PublicBookingConfirmation, manageUrl: string, now = new Date()): string {
  const where = b.locationAddress ?? [b.business.name, b.business.address].filter(Boolean).join(', ');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OutletBooking//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${b.token}@outletbooking`,
    `DTSTAMP:${icsTime(now.toISOString())}`,
    `DTSTART:${icsTime(b.startAt)}`,
    `DTEND:${icsTime(b.endAt)}`,
    `SUMMARY:${icsText(`${b.serviceName} · ${b.business.name}`)}`,
    `LOCATION:${icsText(where)}`,
    `DESCRIPTION:${icsText(`${b.resourceName}\nView or cancel: ${manageUrl}`)}`,
    `URL:${manageUrl}`,
    `STATUS:${b.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
