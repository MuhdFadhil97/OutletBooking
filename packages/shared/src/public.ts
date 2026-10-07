import { z } from 'zod';
import { slugSchema } from './schemas';
import type { BookingStatus, PaymentStatus } from './bookings';
import type { BookingField, LocationType, PriceUnit, ResourceType } from './setup';

/** `/public/:slug` — the business slug from the shared booking link. */
export const publicSlugParam = z.object({ slug: slugSchema });

/** Only what the public booking page needs — no internal settings, no other customers. */
export interface PublicService {
  id: number;
  name: string;
  description: string | null;
  durationMin: number;
  durationOptions: number[] | null;
  priceUnit: PriceUnit;
  priceSen: number;
  depositSen: number;
  prepayFull: boolean;
  locationType: LocationType;
}

export interface PublicBusiness {
  slug: string;
  name: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  timezone: string;
  /** False when the owner has switched online booking off. */
  bookingEnabled: boolean;
  /** e.g. "Court", "Agent", "Bay" */
  resourceLabel: string;
  /** Booking window: earliest start = now + minAdvanceMin; last date = today + maxDaysAhead. */
  minAdvanceMin: number;
  maxDaysAhead: number;
  /** Customers can cancel online until this many minutes before the start. */
  cancelCutoffMin: number;
  services: PublicService[];
  /** Active resources that offer at least one visible service. */
  resources: PublicResource[];
  /** Booking questions (serviceId null = asked for every service). */
  bookingFields: PublicBookingField[];
}

export interface PublicResource {
  id: number;
  name: string;
  resourceType: ResourceType;
  serviceIds: number[];
}

export type PublicBookingField = Pick<
  BookingField,
  'serviceId' | 'fieldKey' | 'label' | 'fieldType' | 'options' | 'isRequired' | 'hint'
>;

/** `/public/bookings/:token` — the random booking token from the confirmation / cancel link. */
export const publicTokenParam = z.object({ token: z.string().regex(/^[0-9a-f]{32}$/) });

/** Price shown on the details step before booking. */
export const publicQuoteQuery = z.object({
  serviceId: z.coerce.number().int().positive(),
  startAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
  durationMin: z.coerce.number().int().positive().optional(),
});
export type PublicQuoteQuery = z.infer<typeof publicQuoteQuery>;

/** Returned after booking and on the confirmation page (via the token). Only this booking's data. */
export interface PublicBookingConfirmation {
  /** Random token for the confirmation / cancel link — never the integer id. */
  token: string;
  status: BookingStatus;
  startAt: string;
  endAt: string;
  durationMin: number;
  serviceName: string;
  resourceName: string;
  /**
   * What the customer typed — only in the booking response. Null when opened from the link,
   * so a phone number never reveals the name the business has stored for it.
   */
  customerName: string | null;
  /** Online cancel allowed until this time (start − cancel cut-off); null when it can't be cancelled online. */
  cancellableUntil: string | null;
  locationAddress: string | null;
  priceSen: number;
  amountDueSen: number;
  paymentStatus: PaymentStatus;
  /** Pending (unpaid) bookings are released at this time. */
  expiresAt: string | null;
  business: Pick<PublicBusiness, 'slug' | 'name' | 'address' | 'phone' | 'whatsappPhone' | 'timezone'>;
}
