import { z } from 'zod';
import { businessSettingsSchema, senSchema, workingHoursSchema } from './setup';
import { PAYMENT_RULES, type BusinessTemplate, type PaymentRule } from './templates';

// ------------------------------------------------------------ payment rule (step 3, Setup "Payment to confirm")

/** The service fields a payment rule controls. */
export interface PaymentFields {
  priceSen: number;
  depositSen: number;
  prepayFull: boolean;
  priceUnit: 'per_booking' | 'per_block';
}

/** The rule one service follows today. */
export function paymentRuleOf(s: PaymentFields): PaymentRule {
  if (s.prepayFull) return 'full';
  if (s.depositSen > 0) return 'deposit';
  return s.priceSen === 0 ? 'none' : 'at_venue';
}

/**
 * What the business asks for overall: one rule when every service agrees, `mixed` otherwise,
 * `null` without services. Free services don't count against "pay at venue".
 */
export function businessPaymentRule(services: PaymentFields[]): PaymentRule | 'mixed' | null {
  if (!services.length) return null;
  const rules = new Set(services.map(paymentRuleOf));
  if (rules.size === 1) return [...rules][0]!;
  if (rules.size === 2 && rules.has('none') && rules.has('at_venue')) return 'at_venue';
  return 'mixed';
}

/**
 * Service changes that make it follow `rule`. A deposit keeps the service's own amount, else the
 * template default (never more than the price). A free service asked for a deposit becomes a
 * booking fee: price = fee, paid in full online.
 */
export function applyPaymentRule(
  s: PaymentFields,
  rule: PaymentRule,
  defaultDepositSen: number,
): Partial<Pick<PaymentFields, 'priceSen' | 'depositSen' | 'prepayFull'>> {
  switch (rule) {
    case 'full':
      return { prepayFull: true, depositSen: 0 };
    case 'deposit': {
      if (s.priceSen === 0) return { priceSen: defaultDepositSen, prepayFull: true, depositSen: 0 };
      const deposit = s.depositSen > 0 ? s.depositSen : defaultDepositSen;
      return { prepayFull: false, depositSen: s.priceUnit === 'per_block' ? deposit : Math.min(deposit, s.priceSen) };
    }
    case 'at_venue':
    case 'none':
      return { prepayFull: false, depositSen: 0 };
  }
}

export const paymentRuleSchema = z.object({ rule: z.enum(PAYMENT_RULES) });
export type PaymentRuleInput = z.infer<typeof paymentRuleSchema>;

// ------------------------------------------------------------ O1c · sign-up step 3 "Finish"

const name = z.string().trim().min(1, 'Enter a name').max(100);

export const onboardingSetupSchema = z.object({
  /** "Other": what customers book (Doctor, Teacher, Room…). */
  resourceLabel: z.string().trim().min(1).max(30).optional(),
  /** Created in this order; `isMe` links the owner's login (agent / stylist who is also the owner). */
  resources: z
    .array(z.object({ name, isMe: z.boolean().default(false) }))
    .min(1, 'Add at least one')
    .max(50)
    .refine((r) => r.filter((x) => x.isMe).length <= 1, 'Only one can be you'),
  /** Weekly opening hours, applied to every resource created here. */
  hours: workingHoursSchema.shape.hours,
  /** Price / length / visibility edits to the template's services. */
  services: z
    .array(
      z.object({
        id: z.number().int().positive(),
        priceSen: senSchema.optional(),
        durationMin: z.number().int().min(5).max(1440).optional(),
        isVisible: z.boolean().optional(),
      }),
    )
    .max(100)
    .default([]),
  /** "Other": the first service. */
  newService: z
    .object({ name, durationMin: z.number().int().min(5).max(1440), priceSen: senSchema })
    .optional(),
  paymentRule: z.enum(PAYMENT_RULES),
  /** Real estate: gap kept free between viewings at the customer's location. */
  travelBufferMin: z.number().int().min(0).max(240).optional(),
  settings: businessSettingsSchema.optional(),
});
export type OnboardingSetupInput = z.input<typeof onboardingSetupSchema>;
export type OnboardingSetup = z.infer<typeof onboardingSetupSchema>;

// ------------------------------------------------------------ ST · Setup tab summary

export interface SetupSummary {
  template: BusinessTemplate;
  resourceLabel: string;
  resources: { count: number; linkedToStaff: number };
  services: {
    count: number;
    minPriceSen: number | null;
    maxPriceSen: number | null;
    /** Distinct customer-selectable lengths across services (minutes). */
    durationOptions: number[];
    maxBufferMin: number;
    maxTravelBufferMin: number;
    /** Services that charge a peak price at some times. */
    peakServiceCount: number;
  };
  /** Weekly hours when every resource shares them; `varies` when they differ; empty = none set. */
  hours: { weekday: number; startTime: string; endTime: string }[];
  hoursVary: boolean;
  paymentRule: PaymentRule | 'mixed' | null;
  maxDepositSen: number;
  /** Active booking question labels. */
  bookingFields: string[];
  /** Active staff members (owner not counted). */
  staffCount: number;
  rules: { minAdvanceMin: number; maxDaysAhead: number; cancelCutoffMin: number; customersCanCancel: boolean };
  mobileServiceVisible: boolean | null;
  settings: Record<string, string | number | boolean | null>;
}
