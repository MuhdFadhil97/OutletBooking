import { z } from 'zod';

/** ST-RE-L · real estate listings customers pick when booking a viewing (FR-17.5). */
export const LISTING_STATUSES = ['available', 'under_offer', 'closed'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

export const listingCreateSchema = z.object({
  /** e.g. LR-0231 — unique per business. */
  ref: z
    .string()
    .trim()
    .min(1, 'Enter a listing ref')
    .max(30)
    .transform((v) => v.toUpperCase()),
  title: z.string().trim().min(2, 'Enter a title').max(120),
  area: optionalText(80),
  address: optionalText(500),
  /** The agent (resource) who shows it; viewings default to this agent on the booking page. */
  agentResourceId: z.number().int().positive().nullable().optional(),
  status: z.enum(LISTING_STATUSES).default('available'),
  openForViewings: z.boolean().default(true),
});
export const listingUpdateSchema = listingCreateSchema.partial();
export type ListingCreateInput = z.input<typeof listingCreateSchema>;
export type ListingCreate = z.infer<typeof listingCreateSchema>;
export type ListingUpdate = z.infer<typeof listingUpdateSchema>;

export const LISTING_FILTERS = ['all', ...LISTING_STATUSES] as const;
export type ListingFilter = (typeof LISTING_FILTERS)[number];

export const listingQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(LISTING_FILTERS).default('all'),
});
export type ListingQuery = z.infer<typeof listingQuery>;

export interface Listing {
  id: number;
  ref: string;
  title: string;
  area: string | null;
  address: string | null;
  agent: { id: number; name: string } | null;
  status: ListingStatus;
  openForViewings: boolean;
  /** Viewings booked for this listing (not cancelled). */
  viewingCount: number;
  /** Customers can pick it now: open for viewings and not closed. */
  bookable: boolean;
}

export interface ListingsResponse {
  listings: Listing[];
  /** All listings (not archived), for the header "N properties". */
  total: number;
}

/** Real estate booking question filled from the picked listing (customers don't type the ref twice). */
export const LISTING_REF_FIELD = 'property_ref';

/** A listing can take new viewings when the switch is on and it is not closed. Booked viewings stay either way. */
export const isListingBookable = (l: { status: ListingStatus | string; openForViewings: boolean }) =>
  l.openForViewings && l.status !== 'closed';

/** On the public booking page (C6) — no internal ids beyond what booking needs. */
export interface PublicListing {
  id: number;
  ref: string;
  title: string;
  area: string | null;
  /** Agent resource id, preselected on the booking page. */
  agentResourceId: number | null;
  /** The exact address stays private (the agent shares it); this only says the viewing address is known. */
  hasAddress: boolean;
}
