import { z } from 'zod';
import { localDate } from './availability';

/** H1: the owner pastes their ToyyibPay User Secret Key (Dashboard → Settings / API). */
export const connectToyyibPaySchema = z.object({
  secretKey: z
    .string()
    .trim()
    .min(8, 'Paste your User Secret Key')
    .max(100)
    .regex(/^[A-Za-z0-9-]+$/, 'The key has only letters, numbers and dashes'),
});
export type ConnectToyyibPayInput = z.infer<typeof connectToyyibPaySchema>;

export type PaymentAccountStatus = 'not_connected' | 'connected' | 'error';

/** What the owner sees about their connection. The key itself is never returned. */
export interface PaymentAccountInfo {
  status: PaymentAccountStatus;
  /** e.g. "…a9f2" */
  secretKeyLast4: string | null;
  categoryCode: string | null;
  connectedAt: string | null;
  /** RM 1.00 test payment passed. */
  testedAt: string | null;
  /** A test bill exists that has not been confirmed paid yet. */
  testPending: boolean;
  lastError: string | null;
}

/** A ToyyibPay bill to open (customer pays deposit / full amount). */
export interface PaymentLink {
  paymentUrl: string;
  amountSen: number;
  /** The hold ends here (pending bookings); null when the booking does not expire. */
  expiresAt: string | null;
}

/** H7 / S2: payment taken in person or by transfer. */
export const MANUAL_PAYMENT_METHODS = ['cash', 'duitnow_qr', 'card', 'bank_transfer'] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export const recordPaymentSchema = z.object({
  amountSen: z.number().int().positive('Enter the amount received'),
  method: z.enum(MANUAL_PAYMENT_METHODS),
  reference: z
    .string()
    .trim()
    .max(100)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

/** D5: bookings on a local date (default tomorrow) with their reminder state. */
export const reminderListQuery = z.object({ date: localDate.optional() });
