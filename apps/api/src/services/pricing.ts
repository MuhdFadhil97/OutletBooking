import { addMinutes } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { and, eq, isNull } from 'drizzle-orm';
import { businesses, servicePriceRules, services, type Db, type Tx } from '@outletbooking/db';
import type { PaymentMode, PriceLine, PriceQuote, PriceUnit } from '@outletbooking/shared';
import { AppError, notFound } from '../errors';
import { allowedDurations } from './availability';

type Q = Db | Tx;

export interface PricedService {
  /** Base duration = one block for per_block pricing. */
  durationMin: number;
  durationOptions: number[] | null;
  priceUnit: PriceUnit;
  /** Per booking, or per block. */
  priceSen: number;
  depositSen: number;
  prepayFull: boolean;
}

export interface PriceRule {
  name: string;
  /** 0 = Sunday. */
  weekday: number;
  /** Local "HH:MM" (or "HH:MM:SS"); end may be "24:00". */
  startTime: string;
  endTime: string;
  priceSen: number;
}

export interface QuoteInput {
  service: PricedService;
  rules: PriceRule[];
  startAt: Date;
  /** Chosen duration (one of the service's duration options). */
  durationMin: number;
  timezone: string;
}

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Peak rule in effect at this instant (local weekday + time); highest price wins if rules overlap. */
function ruleAt(rules: PriceRule[], at: Date, timezone: string): PriceRule | null {
  const weekday = Number(formatInTimeZone(at, timezone, 'i')) % 7; // ISO 1–7 (Mon–Sun) → 0 = Sunday
  const minute = toMinutes(formatInTimeZone(at, timezone, 'HH:mm'));
  let best: PriceRule | null = null;
  for (const r of rules) {
    if (r.weekday !== weekday || minute < toMinutes(r.startTime) || minute >= toMinutes(r.endTime)) continue;
    if (!best || r.priceSen > best.priceSen) best = r;
  }
  return best;
}

/**
 * Pure price calculation (FR-03.5/03.6, FR-15.5).
 * - per_booking: one price; a peak rule applies when the booking starts inside it.
 * - per_block: duration / base duration blocks; each block is priced by the rule in effect
 *   at the block's start (e.g. 17:00–19:00 with peak from 18:00 = 1 normal + 1 peak block).
 * - Payment: prepay_full → whole price; else deposit (capped at the price); else pay at venue.
 */
export function quotePrice(input: QuoteInput): PriceQuote {
  const { service, rules, startAt, durationMin, timezone } = input;
  if (!allowedDurations(service).includes(durationMin)) {
    throw new AppError(400, 'invalid_duration', 'This duration is not offered for the service');
  }

  const lines: PriceLine[] = [];
  if (service.priceUnit === 'per_block') {
    const blocks = durationMin / service.durationMin;
    if (!Number.isInteger(blocks)) {
      throw new AppError(400, 'invalid_duration', 'Duration must be whole blocks of the service duration');
    }
    for (let i = 0; i < blocks; i++) {
      const at = addMinutes(startAt, i * service.durationMin);
      const rule = ruleAt(rules, at, timezone);
      lines.push({
        startAt: at.toISOString(),
        durationMin: service.durationMin,
        priceSen: rule?.priceSen ?? service.priceSen,
        ruleName: rule?.name ?? null,
      });
    }
  } else {
    const rule = ruleAt(rules, startAt, timezone);
    lines.push({
      startAt: startAt.toISOString(),
      durationMin,
      priceSen: rule?.priceSen ?? service.priceSen,
      ruleName: rule?.name ?? null,
    });
  }

  const priceSen = lines.reduce((sum, l) => sum + l.priceSen, 0);
  let paymentMode: PaymentMode = 'none';
  let amountDueSen = 0;
  if (priceSen > 0 && service.prepayFull) {
    paymentMode = 'full';
    amountDueSen = priceSen;
  } else if (priceSen > 0 && service.depositSen > 0) {
    paymentMode = 'deposit';
    amountDueSen = Math.min(service.depositSen, priceSen);
  }

  return {
    priceSen,
    amountDueSen,
    paymentMode,
    paymentStatus: amountDueSen > 0 ? 'unpaid' : 'not_required',
    lines,
  };
}

/** Loads the service, its peak rules and the business timezone, then quotes the booking. */
export async function getPriceQuote(
  q: Q,
  businessId: number,
  input: { serviceId: number; startAt: Date; durationMin?: number },
): Promise<PriceQuote> {
  const [quote] = await getPriceQuotes(q, businessId, input.serviceId, [input.startAt], input.durationMin);
  return quote!;
}

/** Same as getPriceQuote for many start times of one service (e.g. every cell of the court grid), loading once. */
export async function getPriceQuotes(
  q: Q,
  businessId: number,
  serviceId: number,
  starts: Date[],
  durationMin?: number,
): Promise<PriceQuote[]> {
  const [row] = await q
    .select({
      timezone: businesses.timezone,
      durationMin: services.durationMin,
      durationOptions: services.durationOptions,
      priceUnit: services.priceUnit,
      priceSen: services.priceSen,
      depositSen: services.depositSen,
      prepayFull: services.prepayFull,
    })
    .from(services)
    .innerJoin(businesses, eq(businesses.id, services.businessId))
    .where(and(eq(services.businessId, businessId), eq(services.id, serviceId), isNull(services.deletedAt)));
  if (!row) throw notFound('Service');

  const rules = await q
    .select({
      name: servicePriceRules.name,
      weekday: servicePriceRules.weekday,
      startTime: servicePriceRules.startTime,
      endTime: servicePriceRules.endTime,
      priceSen: servicePriceRules.priceSen,
    })
    .from(servicePriceRules)
    .where(and(eq(servicePriceRules.businessId, businessId), eq(servicePriceRules.serviceId, serviceId)));

  const { timezone, ...service } = row;
  return starts.map((startAt) =>
    quotePrice({
      service: { ...service, priceUnit: service.priceUnit as PriceUnit },
      rules,
      startAt,
      durationMin: durationMin ?? service.durationMin,
      timezone,
    }),
  );
}
