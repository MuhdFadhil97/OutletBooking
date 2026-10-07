import { and, eq, isNull, sql } from 'drizzle-orm';
import { businesses, type Db } from '@outletbooking/db';
import type { BusinessProfile, BusinessProfileUpdate } from '@outletbooking/shared';
import { AppError, notFound, pgErrorInfo } from '../errors';
import { isReservedSlug } from './slugs';

const slugTaken = () => new AppError(409, 'slug_taken', 'This booking link is already taken');

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
  autoConfirmPaid: businesses.autoConfirmPaid,
  customersCanCancel: businesses.customersCanCancel,
  lateCancelKeepsDeposit: businesses.lateCancelKeepsDeposit,
  settings: businesses.settings,
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

/** Owner edits profile (E5, incl. booking link) + booking rules (E6). Template and timezone are not editable here. */
export async function updateBusiness(db: Db, businessId: number, input: BusinessProfileUpdate): Promise<BusinessProfile> {
  if (!Object.keys(input).length) return getBusiness(db, businessId);
  const { settings, ...rest } = input;
  if (rest.slug && isReservedSlug(rest.slug)) throw slugTaken();
  try {
    const [row] = await db
      .update(businesses)
      .set({
        ...rest,
        // Shallow merge so screens that own different keys don't overwrite each other.
        ...(settings ? { settings: sql`${businesses.settings} || ${JSON.stringify(settings)}::jsonb` } : {}),
      })
      .where(and(eq(businesses.id, businessId), isNull(businesses.deletedAt)))
      .returning(publicColumns);
    if (!row) throw notFound('Business');
    return row;
  } catch (err) {
    const { code, constraint } = pgErrorInfo(err);
    if (code === '23505' && constraint === 'businesses_slug_unique') throw slugTaken();
    throw err;
  }
}
