import { existsSync } from 'node:fs';

/** Local test database only — refuses anything that is not localhost/*_test. */
export function testDatabaseUrl(): string {
  if (!process.env.TEST_DATABASE_URL && existsSync('.env')) process.loadEnvFile('.env');
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://outlet:outlet@localhost:5432/outletbooking_test';
  const u = new URL(url);
  if (!['localhost', '127.0.0.1'].includes(u.hostname) || !u.pathname.endsWith('_test')) {
    throw new Error(`TEST_DATABASE_URL must be a local *_test database, got ${u.host}${u.pathname}`);
  }
  return url;
}
