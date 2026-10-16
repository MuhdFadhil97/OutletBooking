import { z } from 'zod';
import { emailSchema } from './schemas';
import { PAID_PLANS, type PaidPlan, type PlanCatalogEntry } from './plans';
import type { SubscriptionStatus } from './types';

/**
 * Plan payment on the website (I4, I13–I17): sign in by an emailed link, pay FTech through ToyyibPay,
 * get a numbered receipt. Plans are paid on the website, never in the app (FR-16.4).
 */

/** The sign-in link (FR-20.8): valid this long, usable once. */
export const WEB_SIGN_IN_LINK_MINUTES = 15;
/** Receipt numbers: OB-2026-000124 (sequence per receipt, year of payment). */
export const formatReceiptNo = (year: number, n: number) => `OB-${year}-${String(n).padStart(6, '0')}`;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/** I4 / I17 "Receipt details": who the receipt is made out to. */
export const receiptDetailsSchema = z.object({
  companyName: z.string().trim().min(2, 'Enter the business or company name').max(200),
  ssmNo: optionalText(30),
  tin: optionalText(30),
  address: optionalText(300),
  receiptEmail: emailSchema,
});
export type ReceiptDetailsInput = z.input<typeof receiptDetailsSchema>;
export type ReceiptDetails = z.output<typeof receiptDetailsSchema>;

/** I13: ask for a sign-in link. The answer is always the same, whether or not the email has an account. */
export const webSignInLinkSchema = z.object({ email: emailSchema });
export type WebSignInLinkInput = z.input<typeof webSignInLinkSchema>;

/** I4: pay one month of a plan. */
export const checkoutSchema = z.object({
  plan: z.enum(PAID_PLANS),
  details: receiptDetailsSchema,
});
export type CheckoutInput = z.input<typeof checkoutSchema>;

/**
 * The app opens the website already signed in: the pay page (`pay`, with the plan preselected) or
 * Billing & receipts (`account`).
 */
export const WEB_LINK_PAGES = ['pay', 'account'] as const;
export type WebLinkPage = (typeof WEB_LINK_PAGES)[number];
export const webLinkSchema = z.object({
  plan: z.enum(PAID_PLANS).optional(),
  page: z.enum(WEB_LINK_PAGES).default('pay'),
});
export type WebLinkInput = z.infer<typeof webLinkSchema>;

export interface PlanQuote {
  plan: PaidPlan;
  /** Monthly price plus the resources above the plan's limit. */
  totalSen: number;
  baseSen: number;
  extraResources: number;
  extraSen: number;
}

/** GET /billing/overview (signed-in owner). */
export interface BillingOverview {
  signedInAs: string;
  business: { name: string; slug: string };
  subscription: {
    plan: 'trial' | PaidPlan;
    status: SubscriptionStatus;
    trialEndsAt: string;
    currentPeriodEnd: string | null;
    freeUntil: string | null;
    hasAccess: boolean;
  };
  resourceCount: number;
  resourceLabel: string;
  staffCount: number;
  recommended: PaidPlan;
  /** Plans shown to this business (public ones, plus the one it is on). */
  plans: PlanCatalogEntry[];
  quotes: Record<PaidPlan, PlanQuote>;
  /** When the next paid month would start (trial end, or the end of the paid period), or now. */
  nextPeriodStart: string;
  /** Receipt details saved before, or sensible first values (business name, sign-in email). */
  details: { companyName: string; ssmNo: string | null; tin: string | null; address: string | null; receiptEmail: string };
  detailsSaved: boolean;
  /** False until FTech's own ToyyibPay account is set up; the pay button explains why. */
  onlinePaymentAvailable: boolean;
}

export type PlanPaymentStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'refunded';

/** One plan payment: the receipts list (I17) and the result pages (I15, I16). */
export interface BillingPayment {
  /** The ToyyibPay BillCode: the only reference ever put in a URL. */
  ref: string;
  status: PlanPaymentStatus;
  plan: PaidPlan | null;
  description: string;
  amountSen: number;
  method: string | null;
  /** ToyyibPay transaction reference. */
  transactionRef: string | null;
  receiptNo: string | null;
  paidAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
}

/** GET /billing/payments (history, newest first). */
export interface BillingHistory {
  payments: BillingPayment[];
  /** The free trial, shown as a row with no receipt. */
  trial: { start: string; end: string } | null;
  /** The business's plan today, for the I17 header. */
  subscription: BillingOverview['subscription'];
  plans: PlanCatalogEntry[];
  resourceCount: number;
  resourceLabel: string;
  details: BillingOverview['details'];
  detailsSaved: boolean;
  signedInAs: string;
  businessName: string;
}

/** POST /billing/checkout → send the browser to `paymentUrl`. */
export interface CheckoutResult {
  ref: string;
  paymentUrl: string;
}

/** Error codes the billing pages react to. */
export const BILLING_ERRORS = {
  notOwner: 'owner_only',
  /** Better Auth deletes the login of an unconfirmed email that uses a sign-in link, so the email must be confirmed first. */
  emailNotConfirmed: 'email_not_confirmed',
  notConfigured: 'payment_not_configured',
  notFound: 'payment_not_found',
} as const;
