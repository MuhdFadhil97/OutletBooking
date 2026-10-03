/** How the customer pays to confirm a booking. */
export type PaymentMode = 'full' | 'deposit' | 'none';

export interface PriceLine {
  /** ISO start of the block (or of the booking for per-booking prices). */
  startAt: string;
  durationMin: number;
  priceSen: number;
  /** Peak rule name when a peak price applied, else null (normal price). */
  ruleName: string | null;
}

export interface PriceQuote {
  /** Total price of the booking. */
  priceSen: number;
  /** What must be paid online to confirm: full price, deposit, or 0. */
  amountDueSen: number;
  paymentMode: PaymentMode;
  paymentStatus: 'not_required' | 'unpaid';
  lines: PriceLine[];
}
