import { eq } from 'drizzle-orm';
import { businesses, type Db } from '@outletbooking/db';
import { slugSchema, type SlugAvailabilityResponse } from '@outletbooking/shared';

/** Slugs that would clash with app routes or look official. */
const RESERVED_SLUGS = new Set([
  'api', 'app', 'admin', 'auth', 'book', 'booking', 'bookings', 'dashboard', 'help', 'login',
  'logout', 'me', 'outletbooking', 'pay', 'payment', 'payments', 'public', 'signup', 'staff',
  'support', 'www',
]);

export async function checkSlugAvailability(db: Db, rawSlug: string): Promise<SlugAvailabilityResponse> {
  const parsed = slugSchema.safeParse(rawSlug);
  if (!parsed.success) return { slug: rawSlug, available: false, reason: 'invalid' };
  const slug = parsed.data;
  if (RESERVED_SLUGS.has(slug)) return { slug, available: false, reason: 'taken' };

  // citext column: comparison is case-insensitive
  const [row] = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, slug)).limit(1);
  return row ? { slug, available: false, reason: 'taken' } : { slug, available: true };
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}
