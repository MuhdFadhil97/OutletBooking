import { z } from 'zod';
import { adminReason } from './admin';
import { PAID_PLANS, type PaidPlan } from './plans';

/**
 * I8 · Plan payments: what FTech was paid for plans (ToyyibPay on FTech's account, or a bank transfer
 * recorded by hand). Booking payments go to each business's own ToyyibPay and never appear here.
 */

export const PLAN_PAYMENT_FILTERS = ['all', 'paid', 'not_completed', 'to_check', 'renew_soon'] as const;
export type PlanPaymentFilter = (typeof PLAN_PAYMENT_FILTERS)[number];

/** A bill still unpaid after this long is "to check": the callback may not have arrived (re-check in I27). */
export const PLAN_PAYMENT_CHECK_AFTER_MINUTES = 30;
/** "Renew in 7 days" KPI and chip. */
export const PLAN_RENEW_SOON_DAYS = 7;
/** CSV export is capped, like the audit log. */
export const PLAN_PAYMENTS_EXPORT_MAX_ROWS = 10_000;

export const planPaymentsQuery = z.object({
  /** Business name or link, receipt number, ToyyibPay bill or bank reference. */
  q: z.string().trim().max(100).optional(),
  filter: z.enum(PLAN_PAYMENT_FILTERS).default('all'),
  /** Keyset paging: payments older than this id. */
  beforeId: z.coerce.number().int().positive().optional(),
});
export type PlanPaymentsQuery = z.infer<typeof planPaymentsQuery>;

/** waiting = bill made, not paid yet (younger than the check time); to_check = still unpaid after that. */
export type PlanPaymentRowStatus = 'paid' | 'refunded' | 'not_completed' | 'waiting' | 'to_check';

export interface PlanPaymentRow {
  id: number;
  /** The reference used in URLs: ToyyibPay bill code, or `OBM_…` for a bank transfer. */
  ref: string;
  businessId: number;
  businessName: string;
  plan: PaidPlan | null;
  planName: string | null;
  amountSen: number;
  /** fpx / duitnow_qr / bank_transfer (null = not known yet). */
  method: string | null;
  /** Recorded by an admin instead of paid online. */
  manual: boolean;
  recordedBy: string | null;
  /** ToyyibPay bill code or the bank reference. */
  providerRef: string | null;
  status: PlanPaymentRowStatus;
  receiptNo: string | null;
  /** When it was paid, else when the bill was made. */
  at: string;
}

export interface PlanPaymentKpis {
  /** Paid this calendar month (Malaysia time), in sen. */
  incomeThisMonthSen: number;
  /** This month minus the same period last month. */
  incomeVsLastMonthSen: number;
  /** Failed or expired bills in the last 30 days. */
  notCompleted: number;
  toCheck: number;
  /** Paying businesses whose month ends within PLAN_RENEW_SOON_DAYS. */
  renewSoon: number;
}

export interface PlanPaymentsResponse {
  kpis: PlanPaymentKpis;
  payments: PlanPaymentRow[];
  /** Pass as `beforeId` for the next page; null = no more. */
  nextBeforeId: number | null;
}

/** I8 "Record a bank transfer": marks one month paid, extends the plan and emails the receipt. */
export const recordBankTransferSchema = z.object({
  businessId: z.number().int().positive(),
  plan: z.enum(PAID_PLANS),
  amountSen: z.number().int().min(100, 'Amount is at least RM 1.00').max(10_000_000, 'Amount is too large'),
  bankRef: z.string().trim().min(3, 'Add the bank reference (at least 3 characters)').max(60),
  reason: adminReason,
});
export type RecordBankTransferInput = z.infer<typeof recordBankTransferSchema>;

export interface RecordBankTransferResult {
  payment: PlanPaymentRow;
  /** False when the receipt email could not be sent (the payment still counts; use Resend receipt in I24). */
  receiptEmailed: boolean;
}

export const PLAN_PAYMENT_ERRORS = {
  duplicateReference: 'duplicate_reference',
} as const;

// ------------------------------------------------------------ I24 payment detail & refund

/** Two paid plan payments of one business, for the same amount, this close together look like a double payment. */
export const DOUBLE_PAYMENT_WINDOW_MINUTES = 60;

export const PLAN_REFUND_REASONS = ['charged_twice', 'not_applied', 'first_payment_guarantee', 'other'] as const;
export type PlanRefundReason = (typeof PLAN_REFUND_REASONS)[number];

/** What happens to the plan: keep the paid period (another payment covers it) or end it now. */
export const PLAN_AFTER_REFUND = ['keep', 'end_now'] as const;
export type PlanAfterRefund = (typeof PLAN_AFTER_REFUND)[number];

/** I24 "Record a refund": FTech has already paid the money back by bank transfer. */
export const recordPlanRefundSchema = z.object({
  amountSen: z.number().int().min(100, 'Refund is at least RM 1.00').max(10_000_000, 'Amount is too large'),
  reasonCode: z.enum(PLAN_REFUND_REASONS),
  bankRef: z.string().trim().min(3, 'Add the bank reference of the refund transfer (at least 3 characters)').max(60),
  /** Malaysia calendar day the refund was paid, YYYY-MM-DD. */
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date the refund was paid'),
  planAfter: z.enum(PLAN_AFTER_REFUND),
  reason: adminReason,
});
export type RecordPlanRefundInput = z.infer<typeof recordPlanRefundSchema>;

export const resendPlanReceiptSchema = z.object({ reason: adminReason });

export interface PlanRefundEntry {
  id: number;
  amountSen: number;
  reasonCode: PlanRefundReason | null;
  bankRef: string | null;
  paidOn: string | null;
  recordedBy: string | null;
  createdAt: string;
}

export interface PlanPaymentDetail {
  payment: PlanPaymentRow;
  /** The month this payment bought (Malaysia time), when the payment was applied. */
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  createdAt: string;
  businessSlug: string;
  /** Receipt details at the time of payment. */
  billedTo: string | null;
  receiptEmail: string | null;
  refunds: PlanRefundEntry[];
  refundedSen: number;
  /** What can still be paid back: amount − refunds; 0 unless the payment is paid. */
  refundableSen: number;
  /** Other paid payments of this business for the same amount within DOUBLE_PAYMENT_WINDOW_MINUTES. */
  possibleDouble: { ref: string; receiptNo: string | null; at: string; status: PlanPaymentRowStatus }[];
  /** The business's plan today, for "Plan after refund". */
  subscription: { plan: string; status: string; currentPeriodEnd: string | null } | null;
}

export interface RecordPlanRefundResult {
  detail: PlanPaymentDetail;
  /** False when the refund note email could not be sent (the refund is still recorded). */
  refundEmailed: boolean;
}

export const PLAN_REFUND_ERRORS = {
  notPaid: 'not_paid',
  tooLarge: 'refund_too_large',
  futureDate: 'future_date',
} as const;
