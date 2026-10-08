import { existsSync } from 'node:fs';
import { z } from 'zod';

if (existsSync('.env')) process.loadEnvFile('.env');

const csv = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().optional(),
  DB_PREPARE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.url(),
  TRUSTED_ORIGINS: csv,
  APP_PUBLIC_URL: z.url().default('http://localhost:8081'),
  /** `resend` for staging / production; `console` prints emails to the log (refused in production). */
  MAIL_TRANSPORT: z.enum(['console', 'resend']).default('console'),
  /** Sender, e.g. "OutletBooking <no-reply@outletbooking.my>" — domain verified in Resend. */
  MAIL_FROM: z.string().min(3).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  /** 32 bytes, base64 — encrypts each business's ToyyibPay secret key (AES-256-GCM). */
  APP_ENCRYPTION_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded')
      .optional(),
  ),
  /** Where ToyyibPay can reach this API (callback). Locally: a tunnel URL. Defaults to BETTER_AUTH_URL. */
  API_PUBLIC_URL: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
  TOYYIBPAY_BASE_URL: z.url().default('https://dev.toyyibpay.com'),
  /** FTech's own account — plan payments only (Phase 7). Never used for bookings. */
  PLATFORM_TOYYIBPAY_SECRET_KEY: z.string().optional(),
  PLATFORM_TOYYIBPAY_CATEGORY_CODE: z.string().optional(),
  /** Expo push service; `off` drops push (default in tests). */
  PUSH_TRANSPORT: z.enum(['expo', 'off']).optional(),
}).superRefine((e, ctx) => {
  if (e.NODE_ENV === 'production' && !e.APP_ENCRYPTION_KEY) {
    ctx.addIssue({ code: 'custom', path: ['APP_ENCRYPTION_KEY'], message: 'required in production' });
  }
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    console.error('Invalid environment variables:\n' + z.prettifyError(parsed.error));
    throw new Error('Invalid environment (see apps/api/.env.example)');
  }
  return parsed.data;
}
