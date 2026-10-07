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
  /** Only `console` until an email provider is chosen (refused in production). */
  MAIL_TRANSPORT: z.enum(['console']).default('console'),
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
