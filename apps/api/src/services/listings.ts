import { and, asc, eq, ilike, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { bookingFields, bookings, listings, resources, type Db, type Tx } from '@outletbooking/db';
import {
  isListingBookable,
  LISTING_REF_FIELD,
  type Listing,
  type ListingCreate,
  type ListingQuery,
  type ListingsResponse,
  type ListingStatus,
  type ListingUpdate,
  type PublicListing,
} from '@outletbooking/shared';
import { AppError, notFound, pgErrorInfo } from '../errors';
import { assertResourcesInBusiness } from './ownership';

type Q = Db | Tx;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const live = (businessId: number) => and(eq(listings.businessId, businessId), isNull(listings.deletedAt));

const columns = {
  id: listings.id,
  ref: listings.ref,
  title: listings.title,
  area: listings.area,
  address: listings.address,
  agentId: resources.id,
  agentName: resources.name,
  status: listings.status,
  openForViewings: listings.openForViewings,
  viewingCount: sql<number>`(select count(*)::int from ${bookings}
    where ${bookings.businessId} = ${listings.businessId} and ${bookings.listingId} = ${listings.id}
      and ${bookings.status} not in ('cancelled'))`,
};

function selectListings(q: Q) {
  return q
    .select(columns)
    .from(listings)
    .leftJoin(
      resources,
      and(eq(resources.businessId, listings.businessId), eq(resources.id, listings.agentResourceId), isNull(resources.deletedAt)),
    );
}

type Row = Awaited<ReturnType<ReturnType<typeof selectListings>['execute']>>[number];

const toDto = (r: Row): Listing => ({
  id: r.id,
  ref: r.ref,
  title: r.title,
  area: r.area,
  address: r.address,
  agent: r.agentId !== null && r.agentName !== null ? { id: r.agentId, name: r.agentName } : null,
  status: r.status as ListingStatus,
  openForViewings: r.openForViewings,
  viewingCount: Number(r.viewingCount),
  bookable: isListingBookable({ status: r.status, openForViewings: r.openForViewings }),
});

/** ST-RE-L: search by ref, title or area; filter by status. Open ones first, then by ref. */
export async function listListings(q: Q, businessId: number, query: ListingQuery): Promise<ListingsResponse> {
  const where: (SQL | undefined)[] = [live(businessId)];
  if (query.status !== 'all') where.push(eq(listings.status, query.status));
  if (query.q) {
    const like = `%${escapeLike(query.q)}%`;
    where.push(or(ilike(listings.ref, like), ilike(listings.title, like), ilike(listings.area, like)));
  }
  const [rows, [count]] = await Promise.all([
    selectListings(q)
      .where(and(...where))
      .orderBy(sql`case ${listings.status} when 'available' then 0 when 'under_offer' then 1 else 2 end`, asc(listings.ref)),
    q.select({ n: sql<number>`count(*)::int` }).from(listings).where(live(businessId)),
  ]);
  return { listings: rows.map(toDto), total: Number(count?.n ?? 0) };
}

export async function getListing(q: Q, businessId: number, id: number): Promise<Listing> {
  const [row] = await selectListings(q).where(and(live(businessId), eq(listings.id, id)));
  if (!row) throw notFound('Listing');
  return toDto(row);
}

function mapRefClash(err: unknown): never {
  const { code, constraint } = pgErrorInfo(err);
  if (code === '23505' && constraint === 'listings_business_id_ref_key') {
    throw new AppError(409, 'listing_ref_taken', 'Another listing already uses this ref');
  }
  throw err;
}

/** Closing a listing also stops new viewings (booked ones stay). */
const closedStopsViewings = <T extends { status?: ListingStatus; openForViewings?: boolean }>(input: T): T =>
  input.status === 'closed' ? { ...input, openForViewings: false } : input;

export async function createListing(db: Db, businessId: number, input: ListingCreate): Promise<Listing> {
  if (input.agentResourceId) await assertResourcesInBusiness(db, businessId, [input.agentResourceId]);
  const values = closedStopsViewings(input);
  const [row] = await db
    .insert(listings)
    .values({ businessId, ...values, agentResourceId: values.agentResourceId ?? null })
    .returning({ id: listings.id })
    .catch(mapRefClash);
  return getListing(db, businessId, row!.id);
}

export async function updateListing(db: Db, businessId: number, id: number, input: ListingUpdate): Promise<Listing> {
  if (input.agentResourceId) await assertResourcesInBusiness(db, businessId, [input.agentResourceId]);
  const values = closedStopsViewings(input);
  if (Object.keys(values).length) {
    const updated = await db
      .update(listings)
      .set(values)
      .where(and(live(businessId), eq(listings.id, id)))
      .returning({ id: listings.id })
      .catch(mapRefClash);
    if (!updated.length) throw notFound('Listing');
  }
  return getListing(db, businessId, id);
}

/** Soft delete; past and upcoming viewings keep pointing at it. The ref becomes free again. */
export async function archiveListing(db: Db, businessId: number, id: number): Promise<void> {
  const updated = await db
    .update(listings)
    .set({ deletedAt: new Date(), openForViewings: false, ref: sql`${listings.ref} || '~' || ${listings.id}` })
    .where(and(live(businessId), eq(listings.id, id)))
    .returning({ id: listings.id });
  if (!updated.length) throw notFound('Listing');
}

/** C6: listings customers can pick. */
export async function publicListings(q: Q, businessId: number): Promise<PublicListing[]> {
  return q
    .select({
      id: listings.id,
      ref: listings.ref,
      title: listings.title,
      area: listings.area,
      agentResourceId: listings.agentResourceId,
      hasAddress: sql<boolean>`${listings.address} is not null`,
    })
    .from(listings)
    .where(and(live(businessId), eq(listings.openForViewings, true), notInArray(listings.status, ['closed'])))
    .orderBy(asc(listings.ref));
}

/**
 * Booking for a listing: it must belong to the business and take viewings.
 * Returns its address (the viewing address when the booking has none) and the booking
 * answers with the "Property / listing ref" question filled in from the listing.
 */
export async function resolveListing(
  q: Q,
  businessId: number,
  input: { listingId: number; serviceId: number; customFields?: Record<string, string | number> },
): Promise<{ address: string | null; customFields: Record<string, string | number> }> {
  const [row] = await q
    .select({ ref: listings.ref, address: listings.address, status: listings.status, openForViewings: listings.openForViewings })
    .from(listings)
    .where(and(live(businessId), eq(listings.id, input.listingId)));
  if (!row) throw notFound('Listing');
  if (!isListingBookable(row)) throw new AppError(409, 'listing_closed', 'This property is no longer open for viewings');
  // Only when the business still asks that question (unknown answers are rejected).
  const [refField] = await q
    .select({ id: bookingFields.id })
    .from(bookingFields)
    .where(
      and(
        eq(bookingFields.businessId, businessId),
        eq(bookingFields.fieldKey, LISTING_REF_FIELD),
        eq(bookingFields.fieldType, 'text'),
        eq(bookingFields.isActive, true),
        or(isNull(bookingFields.serviceId), eq(bookingFields.serviceId, input.serviceId)),
      ),
    )
    .limit(1);
  const customFields = input.customFields ?? {};
  return { address: row.address, customFields: refField ? { ...customFields, [LISTING_REF_FIELD]: row.ref } : customFields };
}
