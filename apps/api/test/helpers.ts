import { sql as dsql } from 'drizzle-orm';
import { createDb } from '@outletbooking/db';
import type { SignupInput } from '@outletbooking/shared';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { loadEnv } from '../src/env';
import { testDatabaseUrl } from './test-db-url';

export const WEB_ORIGIN = 'http://localhost:8081';

export function createTestContext() {
  const url = testDatabaseUrl();
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-1234',
    BETTER_AUTH_URL: 'http://localhost:3000',
    TRUSTED_ORIGINS: `${WEB_ORIGIN},outletbooking://`,
  });
  const { db, sql } = createDb(url, { max: 5 });
  const auth = createAuth(db, env);
  const app = createApp({ db, auth, env });

  return {
    db,
    app,
    async reset() {
      await db.execute(dsql`TRUNCATE users, businesses RESTART IDENTITY CASCADE`);
    },
    async close() {
      await sql.end();
    },
    /** POST JSON through the real app. */
    post(path: string, body: unknown, headers: Record<string, string> = {}) {
      return app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: WEB_ORIGIN, ...headers },
        body: JSON.stringify(body),
      });
    },
    /** Signs in through Better Auth and returns the Cookie header to reuse. */
    async login(email: string, password: string): Promise<string> {
      const res = await this.post('/api/auth/sign-in/email', { email, password });
      if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`);
      const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]);
      if (!cookies.length) throw new Error('login returned no cookie');
      return cookies.join('; ');
    },
    get(path: string, cookie?: string, headers: Record<string, string> = {}) {
      return app.request(path, { headers: { ...(cookie ? { cookie } : {}), origin: WEB_ORIGIN, ...headers } });
    },
  };
}

export function signupInput(overrides: Partial<SignupInput> = {}): SignupInput {
  return {
    name: 'Ali Hassan',
    email: 'ali@example.com',
    password: 'password123',
    phone: '+60123456789',
    businessName: 'Ali Courts',
    slug: 'ali-courts',
    template: 'sports',
    ...overrides,
  };
}
