import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { bookings, businesses, customers, resources, services } from '@outletbooking/db';
import { createTestContext } from './helpers';

const ctx = createTestContext();
let bizA = 0;
let bizB = 0;
let court1 = 0;
let court2 = 0;
let resourceB = 0;
let serviceA = 0;
let customerA = 0;
let customerB = 0;

/** Postgres error code of a failed query (drizzle wraps the driver error in `cause`). */
async function pgCode(query: Promise<unknown>): Promise<string | undefined> {
  try {
    await query;
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.cause?.code ?? err.code;
  }
  return undefined;
}

const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00+08:00`);

/** A booking on business A; blocked range = shown range unless overridden. */
function booking(start: string, end: string, extra: Partial<typeof bookings.$inferInsert> = {}) {
  return {
    businessId: bizA,
    resourceId: court1,
    serviceId: serviceA,
    customerId: customerA,
    startAt: at(start),
    endAt: at(end),
    blockedStartAt: at(start),
    blockedEndAt: at(end),
    durationMin: 60,
    ...extra,
  } satisfies typeof bookings.$inferInsert;
}

beforeAll(async () => {
  await ctx.reset();
  const [a, b] = await ctx.db
    .insert(businesses)
    .values([
      { slug: 'booking-a', name: 'Booking A' },
      { slug: 'booking-b', name: 'Booking B' },
    ])
    .returning({ id: businesses.id });
  bizA = a!.id;
  bizB = b!.id;
  const [r1, r2, rb] = await ctx.db
    .insert(resources)
    .values([
      { businessId: bizA, name: 'Court 1', resourceType: 'court' },
      { businessId: bizA, name: 'Court 2', resourceType: 'court' },
      { businessId: bizB, name: 'Agent', resourceType: 'staff' },
    ])
    .returning({ id: resources.id });
  court1 = r1!.id;
  court2 = r2!.id;
  resourceB = rb!.id;
  const [s] = await ctx.db
    .insert(services)
    .values({ businessId: bizA, name: 'Court hour', durationMin: 60 })
    .returning({ id: services.id });
  serviceA = s!.id;
  const [ca, cb] = await ctx.db
    .insert(customers)
    .values([
      { businessId: bizA, name: 'Ali', phone: '+60123456789' },
      { businessId: bizB, name: 'Siti', phone: '+60198765432' },
    ])
    .returning({ id: customers.id });
  customerA = ca!.id;
  customerB = cb!.id;
});
afterAll(() => ctx.close());

describe('customers', () => {
  it('rejects a phone number that is not E.164', async () => {
    expect(await pgCode(ctx.db.insert(customers).values({ businessId: bizA, name: 'X', phone: '0123456789' }))).toBe('23514');
  });

  it('is unique by phone per business, but the same phone may exist in another business', async () => {
    expect(await pgCode(ctx.db.insert(customers).values({ businessId: bizA, name: 'Dup', phone: '+60123456789' }))).toBe('23505');
    await ctx.db.insert(customers).values({ businessId: bizB, name: 'Ali at B', phone: '+60123456789' });
  });
});

describe('bookings', () => {
  it('gets a random public token and stores custom fields as jsonb', async () => {
    const [row] = await ctx.db
      .insert(bookings)
      .values(booking('08:00', '09:00', { customFields: { plate_number: 'WXY1234' } }))
      .returning();
    expect(row!.publicToken).toMatch(/^[0-9a-f]{32}$/);
    expect(row!.status).toBe('pending');
    const found = await ctx.db.select({ id: bookings.id }).from(bookings).where(eq(bookings.publicToken, row!.publicToken));
    expect(found).toHaveLength(1);
    // jsonb containment (served by the GIN index)
    const byField = await ctx.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(sql`${bookings.customFields} @> ${JSON.stringify({ plate_number: 'WXY1234' })}::jsonb`);
    expect(byField).toEqual([{ id: row!.id }]);
  });

  it('rejects an overlapping booking on the same resource (no double booking)', async () => {
    await ctx.db.insert(bookings).values(booking('10:00', '11:00', { status: 'confirmed' }));
    expect(await pgCode(ctx.db.insert(bookings).values(booking('10:30', '11:30')))).toBe('23P01');
    expect(await pgCode(ctx.db.insert(bookings).values(booking('09:30', '10:01')))).toBe('23P01');
  });

  it('allows back-to-back bookings and the same time on another resource', async () => {
    await ctx.db.insert(bookings).values(booking('11:00', '12:00'));
    await ctx.db.insert(bookings).values(booking('10:00', '11:00', { resourceId: court2 }));
  });

  it('blocks the buffer time around a booking, not just the shown time', async () => {
    // Shown 13:00–14:00, blocked 12:30–14:30 (travel buffer before, cleanup buffer after).
    await ctx.db.insert(bookings).values(booking('13:00', '14:00', { blockedStartAt: at('12:30'), blockedEndAt: at('14:30') }));
    expect(await pgCode(ctx.db.insert(bookings).values(booking('14:00', '15:00')))).toBe('23P01');
    await ctx.db.insert(bookings).values(booking('14:30', '15:30'));
  });

  it('frees the slot when a booking is cancelled or marked no-show', async () => {
    const [b] = await ctx.db.insert(bookings).values(booking('16:00', '17:00')).returning({ id: bookings.id });
    expect(await pgCode(ctx.db.insert(bookings).values(booking('16:00', '17:00')))).toBe('23P01');
    await ctx.db.update(bookings).set({ status: 'cancelled', cancelledAt: new Date() }).where(eq(bookings.id, b!.id));
    const [again] = await ctx.db.insert(bookings).values(booking('16:00', '17:00')).returning({ id: bookings.id });
    await ctx.db.update(bookings).set({ status: 'no_show' }).where(eq(bookings.id, again!.id));
    await ctx.db.insert(bookings).values(booking('16:00', '17:00', { status: 'confirmed' }));
  });

  it('cannot re-activate a cancelled booking into a taken slot', async () => {
    const [old] = await ctx.db
      .insert(bookings)
      .values(booking('18:00', '19:00', { status: 'cancelled' }))
      .returning({ id: bookings.id });
    await ctx.db.insert(bookings).values(booking('18:00', '19:00'));
    expect(await pgCode(ctx.db.update(bookings).set({ status: 'confirmed' }).where(eq(bookings.id, old!.id)))).toBe('23P01');
  });

  it('lets only one of two concurrent attempts for the same slot succeed', async () => {
    const results = await Promise.allSettled([
      ctx.db.transaction((tx) => tx.insert(bookings).values(booking('20:00', '21:00'))),
      ctx.db.transaction((tx) => tx.insert(bookings).values(booking('20:30', '21:30'))),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('composite FKs block pointing at another business’s resource or customer', async () => {
    expect(await pgCode(ctx.db.insert(bookings).values(booking('06:00', '07:00', { resourceId: resourceB })))).toBe('23503');
    expect(await pgCode(ctx.db.insert(bookings).values(booking('06:00', '07:00', { customerId: customerB })))).toBe('23503');
    // Claiming business B while using A's resource/service/customer also fails.
    expect(await pgCode(ctx.db.insert(bookings).values(booking('06:00', '07:00', { businessId: bizB })))).toBe('23503');
  });

  it('rejects invalid times, status and money', async () => {
    expect(await pgCode(ctx.db.insert(bookings).values(booking('07:00', '06:00')))).toBe('23514');
    expect(await pgCode(ctx.db.insert(bookings).values(booking('05:00', '06:00', { blockedStartAt: at('05:30') })))).toBe('23514');
    expect(await pgCode(ctx.db.insert(bookings).values(booking('05:00', '06:00', { status: 'done' })))).toBe('23514');
    expect(await pgCode(ctx.db.insert(bookings).values(booking('05:00', '06:00', { priceSen: -1 })))).toBe('23514');
  });

  it('keeps updated_at current', async () => {
    const [b] = await ctx.db.insert(bookings).values(booking('22:00', '23:00')).returning();
    await new Promise((r) => setTimeout(r, 20));
    const [u] = await ctx.db.update(bookings).set({ internalNotes: 'VIP' }).where(eq(bookings.id, b!.id)).returning();
    expect(u!.updatedAt.getTime()).toBeGreaterThan(b!.updatedAt.getTime());
  });
});
