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

/** Returned after booking (and later on the confirmation page via the token). Only this booking's data. */
export interface PublicBookingConfirmation {
  /** Random token for the confirmation / cancel link — never the integer id. */
  token: string;
  status: BookingStatus;
  startAt: string;
  endAt: string;
  durationMin: number;
  serviceName: string;
  resourceName: string;
  customerName: string;
  locationAddress: string | null;
  priceSen: number;
  amountDueSen: number;
  paymentStatus: PaymentStatus;
  /** Pending (unpaid) bookings are released at this time. */
  expiresAt: string | null;
  business: Pick<PublicBusiness, 'slug' | 'name' | 'address' | 'phone' | 'whatsappPhone' | 'timezone'>;
}
