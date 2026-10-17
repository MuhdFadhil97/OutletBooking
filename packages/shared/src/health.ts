import { z } from 'zod';
import { adminReason } from './admin';

/**
 * I27 · System health (docs/wireframes/Admin-Health.dc.html): is the API, database, ToyyibPay, background jobs, email
 * and push working — and what needs a person. Customer details are never shown: a booking is identified by its short
 * reference, and "Re-check now" asks ToyyibPay on the server (admins never see anyone's key).
 */

/** What a ToyyibPay payment check found. */
export const PAYMENT_CHECK_PROBLEMS = ['callback_recheck_mismatch', 'no_callback', 'recheck_failed'] as const;
export type PaymentCheckProblem = (typeof PAYMENT_CHECK_PROBLEMS)[number];

/** A pending bill is re-checked by the job once it is this old (the callback should have arrived by then). */
export const PAYMENT_CHECK_AFTER_MINUTES = 30;
/** …and left alone after this long (an abandoned payment, not a problem; the expiry job re-checks bookings too). */
export const PAYMENT_CHECK_UNTIL_MINUTES = 120;

/** Email templates whose delivery is tracked (the `email_events.template` list). */
export const EMAIL_TEMPLATES = [
  'verify_email',
  'reset_password',
  'staff_invite',
  'receipt',
  'trial_ending',
  'sign_in_link',
  'deletion_notice',
  'announcement',
  'refund_note',
  'plan_renewal',
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

/** Email delivery events that need attention. */
export const EMAIL_PROBLEM_STATUSES = ['bounced', 'complained', 'failed'] as const;
export type EmailProblemStatus = (typeof EMAIL_PROBLEM_STATUSES)[number];
export const EMAIL_STATUSES = ['sent', 'delivered', ...EMAIL_PROBLEM_STATUSES] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/** Failed jobs and email problems are shown for this many days. */
export const HEALTH_LOOKBACK_DAYS = 7;

export type HealthLight = 'ok' | 'warn' | 'down' | 'off';

export interface HealthTile {
  light: HealthLight;
  /** Number of things to look at (payments to check, failed jobs, email problems). */
  count: number | null;
  /** Milliseconds for the API and database checks. */
  ms: number | null;
  /** Why a tile is "off": jobs not running here, email printed to the log, no Resend webhook, no Expo token. */
  note: 'jobs_off' | 'console' | 'webhook_off' | 'no_token' | null;
}

export interface PaymentCheckItem {
  id: number;
  checkedAt: string;
  problem: PaymentCheckProblem;
  callbackStatus: string | null;
  recheckStatus: string | null;
  business: { id: number; name: string };
  /** `booking`: a customer paying a business · `plan`: a business paying FTech. */
  kind: 'booking' | 'plan';
  /** Short booking reference (SA-7Q4K style) for a booking payment; null for a plan payment. */
  bookingRef: string | null;
  billCode: string;
  amountSen: number;
}

export interface FailedJobItem {
  id: string;
  name: string;
  /** The error the job ended with. */
  error: string;
  tries: number;
  maxTries: number;
  failedAt: string;
}

export interface EmailProblemItem {
  id: number;
  at: string;
  template: string;
  /** m***@gmail.com — the full address is never stored. */
  toMasked: string;
  business: { id: number; name: string } | null;
  status: EmailProblemStatus;
  /** Why, when the provider said (e.g. "mailbox does not exist"). */
  detail: string | null;
}

export interface SystemHealth {
  checkedAt: string;
  api: HealthTile;
  database: HealthTile;
  toyyibpay: HealthTile;
  jobs: HealthTile;
  email: HealthTile;
  push: HealthTile;
  paymentChecks: PaymentCheckItem[];
  failedJobs: FailedJobItem[];
  emailProblems: EmailProblemItem[];
}

/** Light for a "things to look at" tile: nothing = ok, anything = warn. */
export const countLight = (n: number): HealthLight => (n === 0 ? 'ok' : 'warn');

export const closePaymentCheckSchema = z.object({ reason: adminReason });
export const retryJobParams = z.object({ name: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/), id: z.uuid() });

/** The answer to "Re-check now". */
export interface RecheckResult {
  /** `paid`: ToyyibPay says paid and it is applied now · `still_pending` / `failed`: ToyyibPay does not say paid · `error`: ToyyibPay could not be reached. */
  outcome: 'paid' | 'still_pending' | 'failed' | 'error';
  /** The check is closed when the payment is now paid. */
  resolved: boolean;
}

/** Plain-language "what to do" for an email problem. */
export function emailProblemAdvice(status: EmailProblemStatus): 'check_address' | 'add_to_contacts' | 'retry_later' {
  return status === 'bounced' ? 'check_address' : status === 'complained' ? 'add_to_contacts' : 'retry_later';
}
