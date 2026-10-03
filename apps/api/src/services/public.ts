import { and, asc, eq, isNull } from 'drizzle-orm';
import { businesses, services, type Db } from '@outletbooking/db';
import type { LocationType, PriceUnit, PublicBusiness } from '@outletbooking/shared';
import { notFound } from '../errors';

/** Business info + visible services for the public booking page (`/book/:slug`). */
export async function getPublicBusiness(db: Db, slug: string): Promise<PublicBusiness> {
  const [biz] = await db
    .select({
      id: businesses.id,
      slug: businesses.slug,
      name: businesses.name,
      description: businesses.description,
      address: businesses.address,
      phone: businesses.phone,
      whatsappPhone: businesses.whatsappPhone,
      timezone: businesses.timezone,
      bookingEnabled: businesses.bookingEnabled,
    })
    .from(businesses)
    .where(and(eq(businesses.slug, slug), isNull(businesses.deletedAt)));
  if (!biz) throw notFound('Business');

  const rows = await db
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
    .where(and(eq(services.businessId, biz.id), eq(services.isVisible, true), isNull(services.deletedAt)))
    .orderBy(asc(services.sortOrder), asc(services.id));

  const { id: _id, ...info } = biz;
  return {
    ...info,
    services: rows.map((s) => ({ ...s, priceUnit: s.priceUnit as PriceUnit, locationType: s.locationType as LocationType })),
  };
}
