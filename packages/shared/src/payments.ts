import { z } from 'zod';

/** H1 · the business's own ToyyibPay connection. The secret key is never sent back — only its last 4. */
export const PAYMENT_ACCOUNT_STATUSES = ['not_connected', 'connected', 'error'] as const;
export type PaymentAccountStatus = (typeof PAYMENT_ACCOUNT_STATUSES)[number];

export interface PaymentAccountView {
  status: PaymentAccountStatus;
  secretKeyLast4: string | null;
  /** Category created on connect ("OutletBooking · <business>"). */
  categoryCode: string | null;
  connectedAt: string | null;
  /** RM 1.00 test payment passed. */
  testedAt: string | null;
  lastError: string | null;
}

export const paymentAccountConnectSchema = z.object({
  secretKey: z
    .string()
    .trim()
    .min(10, 'Paste the whole User Secret Key')
    .max(100)
    .regex(/^[A-Za-z0-9-]+$/, 'A User Secret Key has only letters, numbers and dashes'),
});
export type PaymentAccountConnect = z.infer<typeof paymentAccountConnectSchema>;

/** RM 1.00 test: open `url`, pay in the sandbox / with your bank, then check. */
export interface PaymentTest {
  url: string;
  billCode: string;
  passed: boolean;
}

export const PAYMENT_PURPOSES = ['deposit', 'full_payment', 'balance', 'subscription'] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];
export const PAYMENT_RECORD_STATUSES = ['pending', 'paid', 'failed', 'expired', 'refunded'] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];

/** H7 · how a payment was received when recorded by hand. */
export const MANUAL_PAYMENT_METHODS = ['cash', 'duitnow_qr', 'card', 'bank_transfer'] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];
export type PaymentMethod = ManualPaymentMethod | 'fpx' | 'duitnow';

export const manualPaymentSchema = z.object({
  amountSen: z.number().int().positive('Enter the amount received').max(100_000_000),
  method: z.enum(MANUAL_PAYMENT_METHODS),
  reference: z.string().trim().max(100).optional(),
});
export type ManualPaymentInput = z.infer<typeof manualPaymentSchema>;

export interface PaymentRecord {
  id: number;
  purpose: PaymentPurpose;
  provider: 'toyyibpay' | 'manual';
  method: PaymentMethod | null;
  amountSen: number;
  status: PaymentRecordStatus;
  reference: string | null;
  paidAt: string | null;
  recordedBy: string | null;
  createdAt: string;
}

/** H7 · payments for one booking, plus the current online pay link (if any). */
export interface BookingPayments {
  items: PaymentRecord[];
  paidSen: number;
  /** Whether the business can take online payments (ToyyibPay connected). */
  onlineAvailable: boolean;
  payLink: { url: string; createdAt: string } | null;
}

/** Customer side (C4 / F4): what to pay online for this booking. */
export interface PublicPayment {
  /** Online payment is needed to confirm (pending booking with an amount due). */
  required: boolean;
  amountSen: number;
  status: 'not_required' | 'pending' | 'paid' | 'failed';
  /** False when the business hasn't connected ToyyibPay (pay at the venue / by arrangement). */
  onlineAvailable: boolean;
  /** Last ToyyibPay reference — quoted on F4 ("contact your bank with reference …"). */
  reference: string | null;
}
