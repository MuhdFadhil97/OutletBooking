import { z } from 'zod';
import type { Booking } from './bookings';
import { phoneE164 } from './schemas';

/**
 * D10 customers list · D11 customer profile · PDPA erase (FR-12, FR-18.5).
 * A "visit" is a booking the customer came to: checked in, completed, or confirmed and already over
 * (owners don't always tap Complete).
 */

export const CUSTOMER_FILTERS = ['all', 'regulars', 'new', 'no_shows'] as const;
export type CustomerFilter = (typeof CUSTOMER_FILTERS)[number];

/** Regular from this many visits. */
export const REGULAR_MIN_VISITS = 5;
/** New: added within this many days, at most one visit. */
export const NEW_CUSTOMER_DAYS = 30;
/** The list shows a "N no-shows" tag from this many (the No-shows filter lists anyone with one). */
export const NO_SHOW_TAG_MIN = 2;

export type CustomerTag = 'regular' | 'new' | 'no_shows';

export const customerListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  filter: z.enum(CUSTOMER_FILTERS).default('all'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type CustomerListQuery = z.infer<typeof customerListQuery>;

export interface CustomerSummary {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  visits: number;
  noShows: number;
  /** Start of the most recent visit. */
  lastVisitAt: string | null;
  createdAt: string;
  tag: CustomerTag | null;
}

export interface CustomerList {
  items: CustomerSummary[];
  /** All customers matching the search + filter (for "312 customers"). */
  total: number;
}

export interface CustomerProfile extends CustomerSummary {
  notes: string | null;
  /** Paid minus refunded, all bookings. */
  spentSen: number;
  /** Not finished yet, soonest first. */
  upcoming: Booking[];
  /** Past, cancelled and no-show bookings, newest first (last 50). */
  history: Booking[];
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional();

export const customerCreateSchema = z.object({
  name: z.string().trim().min(1, 'Enter the customer name').max(100),
  phone: phoneE164,
  email: z.union([z.email('Enter a valid email'), z.literal('').transform(() => null)]).nullable().optional(),
  notes: optionalText(2000),
});
export type CustomerCreateInput = z.input<typeof customerCreateSchema>;

export const customerUpdateSchema = customerCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export type CustomerUpdateInput = z.input<typeof customerUpdateSchema>;

/** Which tag the list shows (no-shows first, they matter most at the counter). */
export function customerTag(
  c: { visits: number; noShows: number; createdAt: string },
  now: Date = new Date(),
): CustomerTag | null {
  if (c.noShows >= NO_SHOW_TAG_MIN) return 'no_shows';
  if (c.visits >= REGULAR_MIN_VISITS) return 'regular';
  if (c.visits <= 1 && now.getTime() - Date.parse(c.createdAt) <= NEW_CUSTOMER_DAYS * 86_400_000) return 'new';
  return null;
}
