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
  /** Only needed when "Enhanced push security" is on in the Expo project. */
  EXPO_ACCESS_TOKEN: z.string().optional(),
  /**
   * 32 random bytes, base64. Encrypts each business's ToyyibPay User Secret Key (AES-256-GCM).
   * Required to connect ToyyibPay; changing it makes stored keys unreadable (owners reconnect).
   */
  APP_ENCRYPTION_KEY: z
    .string()
    .optional()
    .refine((v) => v === undefined || Buffer.from(v, 'base64').length === 32, 'APP_ENCRYPTION_KEY must be 32 bytes, base64'),
  /** https://dev.toyyibpay.com (sandbox) or https://toyyibpay.com (live). */
  TOYYIBPAY_BASE_URL: z.url().default('https://dev.toyyibpay.com'),
  /**
   * Where ToyyibPay can reach this API for payment callbacks. Locally: a tunnel URL
   * (Cloudflare Tunnel / ngrok). Defaults to BETTER_AUTH_URL.
   */
  API_PUBLIC_URL: z.url().optional(),
  /** Background jobs (pg-boss): pending-payment expiry, staff day summary, trial reminders. */
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
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
