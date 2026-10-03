import { and, eq, isNull } from 'drizzle-orm';
import { businesses, type Db } from '@outletbooking/db';
import type { BusinessProfile, BusinessProfileUpdate } from '@outletbooking/shared';
import { notFound } from '../errors';

const publicColumns = {
  slug: businesses.slug,
  name: businesses.name,
  template: businesses.template,
  phone: businesses.phone,
  whatsappPhone: businesses.whatsappPhone,
  email: businesses.email,
  address: businesses.address,
  description: businesses.description,
  timezone: businesses.timezone,
  currency: businesses.currency,
  resourceLabel: businesses.resourceLabel,
  slotIntervalMin: businesses.slotIntervalMin,
  minAdvanceMin: businesses.minAdvanceMin,
  maxDaysAhead: businesses.maxDaysAhead,
  cancelCutoffMin: businesses.cancelCutoffMin,
  pendingExpiryMin: businesses.pendingExpiryMin,
  bookingEnabled: businesses.bookingEnabled,
};

/** The caller's own business. businessId always comes from the tenant middleware. */
export async function getBusiness(db: Db, businessId: number): Promise<BusinessProfile> {
  const [row] = await db
    .select(publicColumns)
    .from(businesses)
    .where(and(eq(businesses.id, businessId), isNull(businesses.deletedAt)))
    .limit(1);
  if (!row) throw notFound('Business');
  return row;
}

/** Look up by slug, but only within the caller's business — others are a 404. */
export async function getBusinessBySlug(db: Db, businessId: number, slug: string) {
  const [row] = await db
    .select(publicColumns)
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.slug, slug), isNull(businesses.deletedAt)))
    .limit(1);
  if (!row) throw notFound('Business');
  return row;
}

/** Owner edits profile + booking settings. Slug, template and timezone are not editable here. */
export async function updateBusiness(db: Db, businessId: number, input: BusinessProfileUpdate): Promise<BusinessProfile> {
  if (!Object.keys(input).length) return getBusiness(db, businessId);
  const [row] = await db
    .update(businesses)
    .set(input)
    .where(and(eq(businesses.id, businessId), isNull(businesses.deletedAt)))
    .returning(publicColumns);
  if (!row) throw notFound('Business');
  return row;
}
