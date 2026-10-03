import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql as dsql } from 'drizzle-orm';
import {
  bookingFields,
  businesses,
  resourceServices,
  resources,
  services,
  timeOff,
  workingHours,
} from '@outletbooking/db';
import { createTestContext } from './helpers';

const ctx = createTestContext();
let bizA = 0;
let bizB = 0;
let resourceA = 0;
let serviceA = 0;
let serviceB = 0;

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

beforeAll(async () => {
  await ctx.reset();
  const [a, b] = await ctx.db
    .insert(businesses)
    .values([
      { slug: 'schema-a', name: 'Schema A' },
      { slug: 'schema-b', name: 'Schema B' },
    ])
    .returning({ id: businesses.id });
  bizA = a!.id;
  bizB = b!.id;
  const [r] = await ctx.db
    .insert(resources)
    .values({ businessId: bizA, name: 'Court 1', resourceType: 'court' })
    .returning({ id: resources.id });
  resourceA = r!.id;
  const [sa, sb] = await ctx.db
    .insert(services)
    .values([
      { businessId: bizA, name: 'Court hour', durationMin: 60, durationOptions: [60, 120], priceSen: 4000 },
      { businessId: bizB, name: 'Viewing', durationMin: 30 },
    ])
    .returning({ id: services.id });
  serviceA = sa!.id;
  serviceB = sb!.id;
});
afterAll(() => ctx.close());

describe('phase 2 schema', () => {
  it('stores duration options as an integer array', async () => {
    const [row] = await ctx.db.select().from(services).where(eq(services.id, serviceA));
    expect(row!.durationOptions).toEqual([60, 120]);
  });

  it('composite FK blocks linking a resource to another business’s service', async () => {
    expect(await pgCode(ctx.db.insert(resourceServices).values({ businessId: bizA, resourceId: resourceA, serviceId: serviceB }))).toBe('23503');
    // Same ids, but claiming business B, fails because the resource belongs to A.
    expect(await pgCode(ctx.db.insert(resourceServices).values({ businessId: bizB, resourceId: resourceA, serviceId: serviceB }))).toBe('23503');
    await ctx.db.insert(resourceServices).values({ businessId: bizA, resourceId: resourceA, serviceId: serviceA });
  });

  it('working hours cannot point at another business’s resource', async () => {
    const row = { businessId: bizB, resourceId: resourceA, weekday: 1, startTime: '09:00', endTime: '18:00' };
    expect(await pgCode(ctx.db.insert(workingHours).values(row))).toBe('23503');
    await ctx.db.insert(workingHours).values({ ...row, businessId: bizA });
  });

  it('rejects invalid working hours (end before start, bad weekday)', async () => {
    const base = { businessId: bizA, resourceId: resourceA };
    expect(await pgCode(ctx.db.insert(workingHours).values({ ...base, weekday: 1, startTime: '18:00', endTime: '09:00' }))).toBe('23514');
    expect(await pgCode(ctx.db.insert(workingHours).values({ ...base, weekday: 7, startTime: '09:00', endTime: '18:00' }))).toBe('23514');
  });

  it('allows business-wide time off (resource_id NULL)', async () => {
    await ctx.db.insert(timeOff).values({
      businessId: bizA,
      startAt: new Date('2026-12-25T00:00:00+08:00'),
      endAt: new Date('2026-12-26T00:00:00+08:00'),
      reason: 'Christmas',
    });
  });

  it('booking field keys are unique per business + service, including the "all services" scope', async () => {
    const field = { businessId: bizA, fieldKey: 'plate_number', label: 'Plate number', fieldType: 'text' };
    await ctx.db.insert(bookingFields).values(field);
    expect(await pgCode(ctx.db.insert(bookingFields).values(field))).toBe('23505');
    // Same key scoped to a specific service is allowed.
    await ctx.db.insert(bookingFields).values({ ...field, serviceId: serviceA });
    // Same key in another business is allowed.
    await ctx.db.insert(bookingFields).values({ ...field, businessId: bizB });
    expect(await pgCode(ctx.db.insert(bookingFields).values({ ...field, fieldKey: 'Bad Key' }))).toBe('23514');
  });

  it('updated_at trigger fires on update', async () => {
    await ctx.db.update(services).set({ updatedAt: new Date('2000-01-01') }).where(eq(services.id, serviceA));
    const [row] = await ctx.db.select({ updatedAt: services.updatedAt }).from(services).where(eq(services.id, serviceA));
    expect(row!.updatedAt.getFullYear()).toBeGreaterThan(2000);
  });

  it('deleting a business cascades to its setup rows', async () => {
    await ctx.db.delete(businesses).where(eq(businesses.id, bizA));
    const res = await ctx.db.execute<{ n: number }>(
      dsql`SELECT (SELECT count(*) FROM resources WHERE business_id = ${bizA})
                + (SELECT count(*) FROM working_hours WHERE business_id = ${bizA})
                + (SELECT count(*) FROM booking_fields WHERE business_id = ${bizA}) AS n`,
    );
    expect(Number(res[0]!.n)).toBe(0);
  });
});
