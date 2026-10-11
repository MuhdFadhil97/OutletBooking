import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { eq } from 'drizzle-orm';
import { listings as listingsTable } from '@outletbooking/db';
import type {
  Availability,
  Booking,
  Listing,
  ListingsResponse,
  PublicBookingConfirmation,
  PublicBusiness,
  Resource,
  Service,
} from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

const ctx = createTestContext();
let ownerA = '';
let ownerB = '';
let agentAina = 0;
let viewing = 0; // "Property viewing" from the real estate template (at the property, asks property_ref)

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const create = (body: Record<string, unknown>, cookie = ownerA) => ctx.send('POST', '/listings', cookie, body);

const TZ = 'Asia/Kuala_Lumpur';
const day = (n: number) => formatInTimeZone(addDays(new Date(), n), TZ, 'yyyy-MM-dd');

beforeAll(async () => {
  await ctx.reset();
  const re = { template: 'real_estate' as const };
  expect((await ctx.post('/signup', signupInput({ ...re, email: 'a@example.com', slug: 'laman-a', businessName: 'Laman A' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ ...re, email: 'b@example.com', slug: 'laman-b', businessName: 'Laman B' }))).status).toBe(201);
  ownerA = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');

  agentAina = (await json<Resource>(await ctx.send('POST', '/resources', ownerA, { name: 'Aina', resourceType: 'staff' }), 201)).id;
  const allWeek = { hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '08:00', endTime: '20:00' })) };
  await json(await ctx.send('PUT', `/resources/${agentAina}/working-hours`, ownerA, allWeek));
  const services = await json<Service[]>(await ctx.get('/services', ownerA));
  viewing = services.find((s) => s.name === 'Property viewing')!.id;
  await json(await ctx.send('PATCH', `/services/${viewing}`, ownerA, { resourceIds: [agentAina] }));
});
afterAll(() => ctx.close());

describe('ST-RE-L listings', () => {
  let condo: Listing;

  it('owner creates, lists, searches and filters listings', async () => {
    condo = await json<Listing>(
      await create({ ref: 'lr-0231', title: '3-bed condo', area: 'Puchong', address: 'Unit 12-3, Jalan Puchong', agentResourceId: agentAina }),
      201,
    );
    expect(condo).toMatchObject({ ref: 'LR-0231', agent: { id: agentAina, name: 'Aina' }, status: 'available', bookable: true, viewingCount: 0 });
    await json<Listing>(await create({ ref: 'LR-0170', title: '2-bed apartment', area: 'Subang', status: 'under_offer', openForViewings: false }), 201);

    const all = await json<ListingsResponse>(await ctx.get('/listings', ownerA));
    expect(all.total).toBe(2);
    expect(all.listings.map((l) => l.ref)).toEqual(['LR-0231', 'LR-0170']); // available first
    expect((await json<ListingsResponse>(await ctx.get('/listings?q=subang', ownerA))).listings.map((l) => l.ref)).toEqual(['LR-0170']);
    expect((await json<ListingsResponse>(await ctx.get('/listings?status=under_offer', ownerA))).listings).toHaveLength(1);
  });

  it('refs are unique per business (409), but another business may reuse one', async () => {
    const res = await create({ ref: 'LR-0231', title: 'Duplicate' });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('listing_ref_taken');
    expect((await create({ ref: 'LR-0231', title: 'B condo' }, ownerB)).status).toBe(201);
  });

  it('closing a listing switches viewings off', async () => {
    const terrace = await json<Listing>(await create({ ref: 'LR-0244', title: 'Terrace house' }), 201);
    const closed = await json<Listing>(await ctx.send('PATCH', `/listings/${terrace.id}`, ownerA, { status: 'closed' }));
    expect(closed).toMatchObject({ status: 'closed', openForViewings: false, bookable: false });
  });

  it('tenant isolation: another business cannot read, change or use these listings', async () => {
    expect((await ctx.get(`/listings/${condo.id}`, ownerB)).status).toBe(404);
    expect((await ctx.send('PATCH', `/listings/${condo.id}`, ownerB, { title: 'Hacked' })).status).toBe(404);
    expect((await ctx.send('DELETE', `/listings/${condo.id}`, ownerB)).status).toBe(404);
    // B cannot point a listing at A's agent.
    expect((await create({ ref: 'LR-9', title: 'Shophouse', agentResourceId: agentAina }, ownerB)).status).toBe(404);
    const bList = await json<ListingsResponse>(await ctx.get('/listings', ownerB));
    expect(bList.listings.map((l) => l.title)).toEqual(['B condo']);
  });

  it('validates input', async () => {
    expect((await create({ ref: '', title: 'No ref' })).status).toBe(400);
    expect((await create({ ref: 'LR-1', title: 'Bad', status: 'sold' })).status).toBe(400);
  });
});

describe('C6 · booking a viewing for a listing', () => {
  let condoId = 0;
  let pausedId = 0;
  let slot = '';

  beforeAll(async () => {
    const all = await json<ListingsResponse>(await ctx.get('/listings', ownerA));
    condoId = all.listings.find((l) => l.ref === 'LR-0231')!.id;
    pausedId = all.listings.find((l) => l.ref === 'LR-0170')!.id;
    const slots = await json<Availability>(await ctx.get(`/public/laman-a/slots?serviceId=${viewing}&date=${day(3)}`));
    slot = slots.slots[2]!.startAt;
  });

  const book = (body: Record<string, unknown>) =>
    ctx.post('/public/laman-a/bookings', {
      serviceId: viewing,
      startAt: slot,
      customer: { name: 'Buyer Lee', phone: '+60123000111' },
      customFields: { buyer_or_tenant: 'Buyer' },
      ...body,
    });

  it('the booking page lists only listings open for viewings', async () => {
    const biz = await json<PublicBusiness>(await ctx.get('/public/laman-a'));
    expect(biz.listings).toEqual([{ id: condoId, ref: 'LR-0231', title: '3-bed condo', area: 'Puchong', agentResourceId: agentAina, hasAddress: true }]);
  });

  it('without a listing the customer must type the property ref and address (fallback)', async () => {
    const res = await book({});
    expect(res.status).toBe(400);
  });

  it('booking a listing fills the property ref and the viewing address', async () => {
    const booking = await json<PublicBookingConfirmation>(await book({ listingId: condoId }), 201);
    expect(booking).toMatchObject({ listingTitle: '3-bed condo', locationAddress: 'Unit 12-3, Jalan Puchong' });

    const list = await json<Booking[]>(await ctx.get('/bookings/search?q=LR-0231', ownerA));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      listing: { id: condoId, ref: 'LR-0231', title: '3-bed condo' },
      customFields: { property_ref: 'LR-0231', buyer_or_tenant: 'Buyer' },
    });
    expect((await json<Listing>(await ctx.get(`/listings/${condoId}`, ownerA))).viewingCount).toBe(1);

    const confirmation = await json<PublicBookingConfirmation>(await ctx.get(`/public/bookings/${booking.token}`));
    expect(confirmation.listingTitle).toBe('3-bed condo');
  });

  it('a listing with viewings paused, or another business’s listing, cannot be booked', async () => {
    const paused = await book({ listingId: pausedId });
    expect(paused.status).toBe(409);
    expect(await errorCode(paused)).toBe('listing_closed');
    const [bListing] = await ctx.db.select({ id: listingsTable.id }).from(listingsTable).where(eq(listingsTable.title, 'B condo'));
    expect((await book({ listingId: bListing!.id })).status).toBe(404);
  });

  it('archiving keeps booked viewings and frees the ref', async () => {
    expect((await ctx.send('DELETE', `/listings/${condoId}`, ownerA)).status).toBe(204);
    expect((await ctx.get(`/listings/${condoId}`, ownerA)).status).toBe(404);
    const list = await json<Booking[]>(await ctx.get('/bookings/search?q=Buyer%20Lee', ownerA));
    expect(list[0]!.listing?.title).toBe('3-bed condo');
    expect((await create({ ref: 'LR-0231', title: 'Relisted condo' })).status).toBe(201);
    expect((await json<PublicBusiness>(await ctx.get('/public/laman-a'))).listings.map((l) => l.title)).toEqual(['Relisted condo']);
  });

  it('deleting the business account also removes its listings', async () => {
    const res = await ctx.send('DELETE', '/me', ownerA, { password: 'password123', confirmBusinessName: 'Laman A' });
    expect(res.status).toBe(204);
    const left = await ctx.db.select({ title: listingsTable.title }).from(listingsTable);
    expect(left.map((l) => l.title)).toEqual(['B condo']);
  });
});
