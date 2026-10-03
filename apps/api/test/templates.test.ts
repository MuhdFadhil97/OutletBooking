import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { bookingFields, businesses, servicePriceRules, services } from '@outletbooking/db';
import { BUSINESS_TEMPLATES, TEMPLATE_INFO } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

describe('template data', () => {
  it.each(BUSINESS_TEMPLATES)('%s is valid against the database rules', (key) => {
    const t = TEMPLATE_INFO[key];
    expect(t.slotIntervalMin).toBeGreaterThanOrEqual(5);
    expect(t.slotIntervalMin).toBeLessThanOrEqual(240);

    for (const s of t.services) {
      expect(s.durationMin).toBeGreaterThanOrEqual(5);
      expect(Number.isInteger(s.priceSen) && s.priceSen >= 0).toBe(true);
      expect(s.depositSen ?? 0).toBeLessThanOrEqual(s.priceSen);
      if (s.durationOptions) {
        expect(s.durationOptions).toContain(s.durationMin);
        if (s.priceUnit === 'per_block') {
          for (const d of s.durationOptions) expect(d % s.durationMin).toBe(0);
        }
      }
      for (const r of s.priceRules ?? []) {
        expect(r.startTime).toMatch(TIME);
        expect(r.endTime).toMatch(TIME);
        expect(r.endTime > r.startTime).toBe(true);
        expect(r.weekdays.every((w) => w >= 0 && w <= 6)).toBe(true);
      }
    }

    const keys = t.bookingFields.map((f) => f.fieldKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of t.bookingFields) {
      expect(f.fieldKey).toMatch(/^[a-z][a-z0-9_]{1,39}$/);
      if (f.fieldType === 'select') expect(f.options?.length).toBeGreaterThan(0);
    }
  });
});

describe('sign-up applies the template', () => {
  const ctx = createTestContext();
  beforeEach(() => ctx.reset());
  afterAll(() => ctx.close());

  async function bizId(slug: string) {
    const [b] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, slug));
    return b!.id;
  }

  it('sports: courts with duration options, full prepayment and peak rules', async () => {
    expect((await ctx.post('/signup', signupInput())).status).toBe(201);
    const id = await bizId('ali-courts');

    const svc = await ctx.db.select().from(services).where(eq(services.businessId, id)).orderBy(asc(services.sortOrder));
    expect(svc.map((s) => s.name)).toEqual(['Badminton', 'Futsal', 'Pickleball']);
    expect(svc[0]).toMatchObject({
      durationMin: 60,
      durationOptions: [60, 120, 180],
      priceUnit: 'per_block',
      priceSen: 2000,
      prepayFull: true,
    });

    const rules = await ctx.db.select().from(servicePriceRules).where(eq(servicePriceRules.serviceId, svc[0]!.id));
    expect(rules).toHaveLength(7); // Mon–Fri evenings + Sat/Sun
    expect(rules.find((r) => r.weekday === 1)).toMatchObject({ startTime: '18:00:00', endTime: '23:00:00', priceSen: 3000 });

    const fields = await ctx.db.select().from(bookingFields).where(eq(bookingFields.businessId, id));
    expect(fields).toEqual([expect.objectContaining({ fieldKey: 'players', fieldType: 'number', serviceId: null })]);
  });

  it('real estate: travel buffer, customer-location viewing, listing fields', async () => {
    await ctx.post('/signup', signupInput({ template: 'real_estate', slug: 'rumah-agency' }));
    const id = await bizId('rumah-agency');

    const [viewing] = await ctx.db.select().from(services).where(eq(services.businessId, id)).orderBy(asc(services.sortOrder));
    expect(viewing).toMatchObject({ name: 'Property viewing', travelBufferMin: 30, locationType: 'at_customer_location' });

    const fields = await ctx.db.select().from(bookingFields).where(eq(bookingFields.businessId, id)).orderBy(asc(bookingFields.sortOrder));
    expect(fields.map((f) => f.fieldKey)).toEqual(['property_ref', 'buyer_or_tenant', 'budget']);
    expect(fields[0]).toMatchObject({ isRequired: true, isSearchable: true });
    expect(fields[1]!.options).toEqual(['Buyer', 'Tenant']);
  });

  it('vehicle inspection: searchable plate number', async () => {
    await ctx.post('/signup', signupInput({ template: 'vehicle_inspection', slug: 'car-check' }));
    const id = await bizId('car-check');
    const [plate] = await ctx.db.select().from(bookingFields).where(eq(bookingFields.businessId, id)).orderBy(asc(bookingFields.sortOrder));
    expect(plate).toMatchObject({ fieldKey: 'plate_number', isSearchable: true, isRequired: true });
  });

  it('"other" starts empty', async () => {
    await ctx.post('/signup', signupInput({ template: 'other', slug: 'blank-biz' }));
    const id = await bizId('blank-biz');
    expect(await ctx.db.select().from(services).where(eq(services.businessId, id))).toHaveLength(0);
  });
});
