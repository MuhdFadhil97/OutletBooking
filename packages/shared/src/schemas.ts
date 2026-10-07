import { z } from 'zod';
import { BUSINESS_TEMPLATES } from './templates';

/**
 * Turns what Malaysians usually type into E.164: "012-345 6789" → "+60123456789",
 * "60123456789" → "+60123456789". Already-international numbers are kept.
 */
export function normalizeMyPhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('60')) return `+${digits}`;
  if (digits.startsWith('0')) return `+60${digits.slice(1)}`;
  return digits ? `+60${digits}` : '';
}

/** Lowercase-dash slug suggestion from a business name: "Smash Arena PJ" → "smash-arena-pj" */
export function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/** Malaysian / international phone in E.164, e.g. +60123456789 */
export const phoneE164 = z
  .string()
  .trim()
  .regex(/^\+[1-9][0-9]{7,14}$/, 'Use international format, e.g. +60123456789');

/** Expo push token of a signed-in device (FR-10.1). */
export const pushTokenSchema = z.object({
  token: z.string().regex(/^Expo(nent)?PushToken\[[^\]]+\]$/, 'Not an Expo push token'),
  platform: z.enum(['android', 'ios', 'web']),
});
export type PushTokenInput = z.infer<typeof pushTokenSchema>;

/** Must match the CHECK on businesses.slug */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{2,49}$/, '3–50 characters: lowercase letters, numbers and dashes');

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email'));

export const passwordSchema = z.string().min(8, 'At least 8 characters').max(128);

export const templateSchema = z.enum(BUSINESS_TEMPLATES);

/** Sign-up step 1: owner account */
export const signupAccountSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(100),
  email: emailSchema,
  password: passwordSchema,
  phone: phoneE164,
});

/** Sign-up step 2: business */
export const signupBusinessSchema = z.object({
  businessName: z.string().trim().min(2, 'Enter your business name').max(100),
  slug: slugSchema,
  template: templateSchema,
});

export const signupSchema = signupAccountSchema.extend(signupBusinessSchema.shape);
export type SignupInput = z.infer<typeof signupSchema>;

/** Login does not enforce password length rules (only sign-up does). */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const slugAvailabilityQuery = z.object({ slug: z.string() });
