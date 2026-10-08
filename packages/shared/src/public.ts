import { z } from 'zod';
import { slugSchema } from './schemas';
import type { AvailableSlot } from './availability';
import type { BookingStatus, PaymentStatus } from './bookings';
import type { PublicPayment } from './payments';
import type { BusinessTemplate } from './templates';
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

/** What customers are told about cancelling (E6). */
export interface PublicCancelPolicy {
  customersCanCancel: boolean;
  /** Free cancellation until this many minutes before the start. */
  cancelCutoffMin: number;
  lateCancelKeepsDeposit: boolean;
}

/** Template settings the booking page uses — never the business's other settings. */
export interface PublicSettings {
  /** Vehicle inspection: travel fee shown on at-customer services (paid with the balance). */
  mobileFeeSen?: number;
  serviceArea?: string;
  /** Salon / people types: customers may pick a person; default true for people types. */
  customersPickResource?: boolean;
  /** Workshop: prices are "from" prices. */
  pricesFrom?: boolean;
}

export interface PublicBusiness {
  slug: string;
  name: string;
  /** Drives the page flow (court grid for sports, date & time list otherwise). */
  template: BusinessTemplate;
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
  /** Unpaid bookings hold the slot this long. */
  pendingExpiryMin: number;
  cancelPolicy: PublicCancelPolicy;
  settings: PublicSettings;
  /** Opening hours: per weekday the earliest start and latest end across bookable resources. */
  hours: { weekday: number; startTime: string; endTime: string }[];
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

/** A free slot with its price (court grid "RM 30"). */
export interface PublicSlot extends AvailableSlot {
  priceSen: number;
}

export interface PublicAvailability {
  date: string;
  timezone: string;
  durationMin: number;
  slots: PublicSlot[];
}

/** Returned after booking and on the view / cancel page (by token). Only this booking's data. */
export interface PublicBookingConfirmation {
  /** Random token for the confirmation / cancel link — never the integer id. */
  token: string;
  /** Short reference, e.g. "2P9C". */
  ref: string;
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
  /** The customer's answers, with question labels (C5c "Vehicle WXY 1234"). */
  answers: { label: string; value: string }[];
  /** Whether the customer may cancel online now, and until when (F5). */
  cancel: { allowed: boolean; until: string | null };
  /** Online payment (Phase 5, ToyyibPay with the business's own account). */
  payment: PublicPayment;
  business: Pick<PublicBusiness, 'slug' | 'name' | 'template' | 'address' | 'phone' | 'whatsappPhone' | 'timezone'>;
}

/** `/public/bookings/:token` — the random booking token from the confirmation link. */
export const publicTokenParam = z.object({ token: z.string().regex(/^[a-f0-9]{32}$/, 'Invalid booking link') });
