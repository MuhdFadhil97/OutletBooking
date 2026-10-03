import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { businesses, servicePriceRules, services } from '@outletbooking/db';
import { getPriceQuote, quotePrice, type PricedService, type PriceRule } from '../src/services/pricing';
import { createTestContext } from './helpers';

const TZ = 'Asia/Kuala_Lumpur';
/** Malaysia local time → Date. 2 Nov 2026 = Monday, 7 Nov = Saturday. */
const my = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+08:00`);
const MON = '2026-11-02';
const SAT = '2026-11-07';

const court: PricedService = {
  durationMin: 60,
  durationOptions: [60, 120, 180],
  priceUnit: 'per_block',
  priceSen: 2000,
  depositSen: 0,
  prepayFull: true,
};
const WEEKDAYS = [1, 2, 3, 4, 5];
const peak: PriceRule[] = [
  ...WEEKDAYS.map((weekday) => ({ name: 'Peak (weekday evening)', weekday, startTime: '18:00', endTime: '23:00', priceSen: 3000 })),
  ...[0, 6].map((weekday) => ({ name: 'Peak (weekend)', weekday, startTime: '08:00', endTime: '23:00', priceSen: 3000 })),
];

const quote = (service: PricedService, start: Date, durationMin: number, rules: PriceRule[] = peak) =>
  quotePrice({ service, rules, startAt: start, durationMin, timezone: TZ });

describe('quotePrice', () => {
  it('per block: price × number of blocks (off-peak)', () => {
    const q = quote(court, my(MON, '10:00'), 120);
    expect(q.priceSen).toBe(4000);
    expect(q.lines.map((l) => [l.priceSen, l.ruleName])).toEqual([
      [2000, null],
      [2000, null],
    ]);
  });

  it('per block: each block uses the rate at its own start (crossing into peak)', () => {
    const q = quote(court, my(MON, '17:00'), 180);
    // 17:00 normal, 18:00 peak, 19:00 peak
    expect(q.priceSen).toBe(2000 + 3000 + 3000);
    expect(q.lines.map((l) => l.ruleName)).toEqual([null, 'Peak (weekday evening)', 'Peak (weekday evening)']);
  });

  it('peak ends at the rule end time (end is exclusive)', () => {
    expect(quote(court, my(MON, '22:00'), 120).priceSen).toBe(3000 + 2000); // 22:00 peak, 23:00 normal
  });

  it('weekend rule uses the Malaysia weekday, not the UTC weekday', () => {
    // Sat 07:00 local = Fri 23:00 UTC. Weekend peak starts 08:00 → first block normal, second peak.
    expect(quote(court, my(SAT, '07:00'), 120).priceSen).toBe(2000 + 3000);
    // Mon 07:00 local = Sun 23:00 UTC — must NOT get Sunday's weekend peak.
    expect(quote(court, my(MON, '07:00'), 60).priceSen).toBe(2000);
  });

  it('overlapping rules: the higher price wins', () => {
    const rules = [...peak, { name: 'Holiday eve', weekday: 1, startTime: '20:00', endTime: '22:00', priceSen: 4500 }];
    expect(quote(court, my(MON, '20:00'), 60, rules).lines[0]).toMatchObject({ priceSen: 4500, ruleName: 'Holiday eve' });
  });

  it('per booking: one price whatever the duration; peak by start time', () => {
    const viewing: PricedService = { durationMin: 30, durationOptions: null, priceUnit: 'per_booking', priceSen: 0, depositSen: 0, prepayFull: false };
    expect(quote(viewing, my(MON, '19:00'), 30, [])).toMatchObject({ priceSen: 0, amountDueSen: 0, paymentMode: 'none', paymentStatus: 'not_required' });

    const inspection: PricedService = { durationMin: 60, durationOptions: [60, 90], priceUnit: 'per_booking', priceSen: 25000, depositSen: 5000, prepayFull: false };
    const rules: PriceRule[] = [{ name: 'Weekend', weekday: 6, startTime: '09:00', endTime: '18:00', priceSen: 30000 }];
    expect(quote(inspection, my(MON, '10:00'), 90, rules).priceSen).toBe(25000);
    expect(quote(inspection, my(SAT, '10:00'), 60, rules)).toMatchObject({ priceSen: 30000, lines: [{ ruleName: 'Weekend', durationMin: 60 }] });
  });

  it('full prepayment: amount due = whole price', () => {
    expect(quote(court, my(MON, '17:00'), 120)).toMatchObject({ priceSen: 5000, amountDueSen: 5000, paymentMode: 'full', paymentStatus: 'unpaid' });
  });

  it('deposit: amount due = deposit, capped at the price', () => {
    const svc: PricedService = { ...court, prepayFull: false, depositSen: 1000 };
    expect(quote(svc, my(MON, '10:00'), 120)).toMatchObject({ priceSen: 4000, amountDueSen: 1000, paymentMode: 'deposit', paymentStatus: 'unpaid' });
    // Per-block deposit can be more than one block's price; never more than the total.
    const big: PricedService = { ...svc, depositSen: 5000 };
    expect(quote(big, my(MON, '10:00'), 60).amountDueSen).toBe(2000);
  });

  it('pay at venue: nothing due online', () => {
    const svc: PricedService = { ...court, prepayFull: false, depositSen: 0 };
    expect(quote(svc, my(MON, '10:00'), 60)).toMatchObject({ priceSen: 2000, amountDueSen: 0, paymentMode: 'none', paymentStatus: 'not_required' });
  });

  it('free service never asks for payment, even with prepay on', () => {
    const svc: PricedService = { ...court, priceSen: 0 };
    expect(quote(svc, my(MON, '10:00'), 60, [])).toMatchObject({ priceSen: 0, amountDueSen: 0, paymentMode: 'none' });
  });

  it('rejects durations the service does not offer', () => {
    expect(() => quote(court, my(MON, '10:00'), 90)).toThrow(/not offered/);
    const fixed: PricedService = { ...court, durationOptions: null };
    expect(() => quote(fixed, my(MON, '10:00'), 120)).toThrow(/not offered/);
  });
});

describe('getPriceQuote (database)', () => {
  const ctx = createTestContext();
  let bizA = 0;
  let bizB = 0;
  let serviceA = 0;

  beforeAll(async () => {
    await ctx.reset();
    const [a, b] = await ctx.db
      .insert(businesses)
      .values([
        { slug: 'price-a', name: 'Price A', template: 'sports' },
        { slug: 'price-b', name: 'Price B' },
      ])
      .returning({ id: businesses.id });
    bizA = a!.id;
    bizB = b!.id;
    const [s] = await ctx.db
      .insert(services)
      .values({ businessId: bizA, name: 'Badminton', durationMin: 60, durationOptions: [60, 120], priceUnit: 'per_block', priceSen: 2000, prepayFull: true })
      .returning({ id: services.id });
    serviceA = s!.id;
    await ctx.db.insert(servicePriceRules).values({ businessId: bizA, serviceId: serviceA, name: 'Peak', weekday: 1, startTime: '18:00', endTime: '23:00', priceSen: 3000 });
  });
  afterAll(() => ctx.close());

  it('quotes using stored peak rules and the business timezone', async () => {
    const q = await getPriceQuote(ctx.db, bizA, { serviceId: serviceA, startAt: my(MON, '17:00'), durationMin: 120 });
    expect(q).toMatchObject({ priceSen: 5000, amountDueSen: 5000, paymentMode: 'full' });
    expect(q.lines.map((l) => l.ruleName)).toEqual([null, 'Peak']);
  });

  it('defaults to the base duration', async () => {
    expect((await getPriceQuote(ctx.db, bizA, { serviceId: serviceA, startAt: my(MON, '10:00') })).priceSen).toBe(2000);
  });

  it('404s for another business’s service', async () => {
    await expect(getPriceQuote(ctx.db, bizB, { serviceId: serviceA, startAt: my(MON, '10:00') })).rejects.toMatchObject({ status: 404 });
  });
});
