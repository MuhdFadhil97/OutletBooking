import { z } from 'zod';
import { slugSchema } from './schemas';
import type { LocationType, PriceUnit } from './setup';

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
  services: PublicService[];
}
