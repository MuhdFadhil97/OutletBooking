import { addMinutes } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { and, asc, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import {
  bookingEvents,
  bookingFields,
  bookings,
  businesses,
  customers,
  resources,
  resourceServices,
  services,
  workingHours,
  type Db,
  type Tx,
} from '@outletbooking/db';
import {
  TEMPLATE_INFO,
  type AvailabilityQuery,
  type BookingStatus,
  type BusinessTemplate,
  type PublicAvailability,
  type PublicSettings,
} from '@outletbooking/shared';
import type {
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
import { getPriceQuote, getPriceQuotes } from './pricing';

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
  template: businesses.template,
  customersCanCancel: businesses.customersCanCancel,
  cancelCutoffMin: businesses.cancelCutoffMin,
  lateCancelKeepsDeposit: businesses.lateCancelKeepsDeposit,
  settings: businesses.settings,
};

/** Only the template settings the booking page needs. */
function publicSettings(template: BusinessTemplate, s: Record<string, unknown>): PublicSettings {
  const out: PublicSettings = {};
  if (typeof s.mobileFeeSen === 'number') out.mobileFeeSen = s.mobileFeeSen;
  if (typeof s.serviceArea === 'string' && s.serviceArea) out.serviceArea = s.serviceArea;
  out.customersPickResource =
    typeof s.customersPickResource === 'boolean' ? s.customersPickResource : TEMPLATE_INFO[template].resourceSetup === 'people';
  if (s.pricesFrom === true) out.pricesFrom = true;
  return out;
}

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
  const { id, customersCanCancel, cancelCutoffMin, lateCancelKeepsDeposit, settings, template: rawTemplate, ...info } =
    await findBusiness(db, slug);
  const template = rawTemplate as BusinessTemplate;

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

  // Opening hours for the header: per weekday, earliest start → latest end over bookable resources.
  const resourceIds = [...byResource.keys()];
  const hourRows = resourceIds.length
    ? await db
        .select({
          weekday: workingHours.weekday,
          startTime: sql<string>`to_char(min(${workingHours.startTime}), 'HH24:MI')`,
          endTime: sql<string>`case when bool_or(${workingHours.endTime} = '24:00') then '24:00' else to_char(max(${workingHours.endTime}), 'HH24:MI') end`,
        })
        .from(workingHours)
        .where(and(eq(workingHours.businessId, id), inArray(workingHours.resourceId, resourceIds)))
        .groupBy(workingHours.weekday)
        .orderBy(asc(workingHours.weekday))
    : [];

  return {
    ...info,
    template,
    cancelPolicy: { customersCanCancel, cancelCutoffMin, lateCancelKeepsDeposit },
    settings: publicSettings(template, settings),
    hours: hourRows,
    services: svcRows.map((s) => ({ ...s, priceUnit: s.priceUnit as PriceUnit, locationType: s.locationType as LocationType })),
    resources: [...byResource.values()],
    bookingFields: fields
      .filter((f) => f.serviceId === null || serviceIds.includes(f.serviceId))
      .map((f) => ({ ...f, fieldType: f.fieldType as PublicBusiness['bookingFields'][number]['fieldType'] })),
  };
}

/** Free slots for customers, each with its price: booking window (advance notice, max days ahead) applies. */
export async function getPublicSlots(
  db: Db,
  slug: string,
  query: AvailabilityQuery,
  now = new Date(),
): Promise<PublicAvailability> {
  const biz = await findBusiness(db, slug);
  assertBookingOpen(biz);
  await visibleService(db, biz.id, query.serviceId);
  const availability = await getAvailability(db, biz.id, query, { now });
  const quotes = await getPriceQuotes(
    db,
    biz.id,
    query.serviceId,
    availability.slots.map((s) => new Date(s.startAt)),
    availability.durationMin,
  );
  return { ...availability, slots: availability.slots.map((s, i) => ({ ...s, priceSen: quotes[i]!.priceSen })) };
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
): Promise<PublicBookingConfirmation> {
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
      // The name as typed: the confirmation shows this, never the name already stored for the phone.
      details: { source: 'web', status, customerName: input.customer.name },
    });

    return publicBookingView(tx, row!.token, now);
  });
}

/** F5 / confirmation: one booking by its random token — only this booking's data. */
async function publicBookingView(q: Q, token: string, now = new Date()): Promise<PublicBookingConfirmation> {
  const [row] = await q
    .select({
      bookingId: bookings.id,
      businessId: bookings.businessId,
      status: bookings.status,
      startAt: bookings.startAt,
      endAt: bookings.endAt,
      durationMin: bookings.durationMin,
      serviceName: services.name,
      resourceName: resources.name,
      storedCustomerName: customers.name,
      source: bookings.source,
      locationAddress: bookings.locationAddress,
      priceSen: bookings.priceSen,
      amountDueSen: bookings.amountDueSen,
      paymentStatus: bookings.paymentStatus,
      expiresAt: bookings.expiresAt,
      customFields: bookings.customFields,
      biz: {
        slug: businesses.slug,
        name: businesses.name,
        template: businesses.template,
        address: businesses.address,
        phone: businesses.phone,
        whatsappPhone: businesses.whatsappPhone,
        timezone: businesses.timezone,
        customersCanCancel: businesses.customersCanCancel,
        cancelCutoffMin: businesses.cancelCutoffMin,
      },
    })
    .from(bookings)
    .innerJoin(businesses, and(eq(businesses.id, bookings.businessId), isNull(businesses.deletedAt)))
    .innerJoin(services, and(eq(services.businessId, bookings.businessId), eq(services.id, bookings.serviceId)))
    .innerJoin(resources, and(eq(resources.businessId, bookings.businessId), eq(resources.id, bookings.resourceId)))
    .innerJoin(customers, and(eq(customers.businessId, bookings.businessId), eq(customers.id, bookings.customerId)))
    .where(eq(bookings.publicToken, token));
  if (!row) throw notFound('Booking');

  const labels = await q
    .select({ key: bookingFields.fieldKey, label: bookingFields.label })
    .from(bookingFields)
    .where(eq(bookingFields.businessId, row.businessId));
  const labelOf = new Map(labels.map((l) => [l.key, l.label]));
  // Web bookings show the name typed when booking: a stranger who knows a phone number must not
  // learn the name stored for it. Bookings made by the business show the stored name.
  const [created] = await q
    .select({ details: bookingEvents.details })
    .from(bookingEvents)
    .where(and(eq(bookingEvents.bookingId, row.bookingId), eq(bookingEvents.eventType, 'created')))
    .limit(1);
  const typedName = typeof created?.details.customerName === 'string' ? created.details.customerName : null;
  const customerName = row.source === 'web' ? (typedName ?? '') : row.storedCustomerName;
  const answers = Object.entries(row.customFields)
    .filter(([k, v]) => labelOf.has(k) && v !== '' && v !== null)
    .map(([k, v]) => ({ label: labelOf.get(k)!, value: String(v) }));

  const { customersCanCancel, cancelCutoffMin, ...business } = row.biz;
  const until = new Date(row.startAt.getTime() - cancelCutoffMin * 60_000);
  const open = row.status === 'pending' || row.status === 'confirmed';
  return {
    token,
    ref: token.slice(0, 4).toUpperCase(),
    status: row.status as BookingStatus,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    durationMin: row.durationMin,
    serviceName: row.serviceName,
    resourceName: row.resourceName,
    customerName,
    locationAddress: row.locationAddress,
    priceSen: row.priceSen,
    amountDueSen: row.amountDueSen,
    paymentStatus: row.paymentStatus as PaymentStatus,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    answers,
    cancel: { allowed: customersCanCancel && open && now < until, until: customersCanCancel ? until.toISOString() : null },
    business: { ...business, template: business.template as BusinessTemplate },
  };
}

export const getPublicBooking = (db: Db, token: string, now = new Date()) => publicBookingView(db, token, now);

/** F5 · customer cancels from their link: allowed by the business, still open, before the cut-off. */
export async function cancelPublicBooking(db: Db, token: string, now = new Date()): Promise<PublicBookingConfirmation> {
  return db.transaction(async (tx) => {
    const view = await publicBookingView(tx, token, now);
    if (!view.cancel.allowed) {
      throw new AppError(409, 'cannot_cancel', 'This booking can no longer be cancelled online. Please contact the business.');
    }
    const [b] = await tx
      .update(bookings)
      .set({ status: 'cancelled', cancelledAt: now, cancelReason: 'Cancelled by customer' })
      .where(and(eq(bookings.publicToken, token), inArray(bookings.status, ['pending', 'confirmed'])))
      .returning({ id: bookings.id, businessId: bookings.businessId });
    if (!b) throw new AppError(409, 'cannot_cancel', 'This booking can no longer be cancelled online.');
    await recordBookingEvent(tx, {
      businessId: b.businessId,
      bookingId: b.id,
      type: 'cancelled',
      actorUserId: null,
      details: { from: view.status, by: 'customer' },
    });
    return publicBookingView(tx, token, now);
  });
}
