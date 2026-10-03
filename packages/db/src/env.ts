import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * DB scripts (migrate, seed, drizzle-kit) share the API's env file so
 * DATABASE_URL lives in one place: apps/api/.env
 */
export function loadApiEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, '../../../apps/api/.env');
  if (!process.env.DATABASE_URL && existsSync(envPath)) process.loadEnvFile(envPath);
}

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (copy apps/api/.env.example to apps/api/.env)');
  return url;
}

/** Guard so local scripts never touch staging/production by accident. */
export function assertLocalDatabase(url: string): void {
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host) && process.env.ALLOW_REMOTE_DB !== '1') {
    console.error(`Refusing to run against non-local database host "${host}". Set ALLOW_REMOTE_DB=1 to confirm.`);
    process.exit(1);
  }
}
