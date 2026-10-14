import { z } from 'zod';
import { phoneE164 } from './schemas';

/** I19 website contact form → `leads` (FR-20.11). Shown later in the admin support screen (I11). */

export const LEAD_REASONS = ['demo', 'question', 'account_help'] as const;
export type LeadReason = (typeof LEAD_REASONS)[number];

export const LEAD_STATUSES = ['new', 'contacted', 'won', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const leadCreateSchema = z
  .object({
    reason: z.enum(LEAD_REASONS),
    name: z.string().trim().min(1, 'Enter your name').max(100),
    businessName: optionalText(150),
    phone: z.preprocess((v) => (v === '' ? undefined : v), phoneE164.optional()),
    email: z.preprocess((v) => (v === '' ? undefined : v), z.email('Enter a valid email').max(200).optional()),
    businessType: optionalText(50),
    resourceCount: optionalText(50),
    message: optionalText(2000),
    /** "I agree that FTech may contact me about this request" — required. */
    consent: z.literal(true, 'Tick the box so we can contact you'),
  })
  .refine((v) => v.phone !== undefined || v.email !== undefined, {
    message: 'Give a mobile number or an email',
    path: ['phone'],
  });
export type LeadCreateInput = z.input<typeof leadCreateSchema>;

export interface LeadCreated {
  ok: true;
}
