import { sql as dsql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { accounts, createDb, users } from '@outletbooking/db';
import type { SignupInput } from '@outletbooking/shared';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { loadEnv } from '../src/env';
import type { MailMessage } from '../src/services/mailer';
import type { PushMessage, PushSender, PushTicket } from '../src/services/push';
import { ToyyibPayError, type BillTransaction, type CreateBillInput, type ToyyibPayClient } from '../src/services/toyyibpay';
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
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    API_PUBLIC_URL: 'https://api.test',
    JOBS_ENABLED: 'false',
  });
  const { db, sql } = createDb(url, { max: 5 });
  /** Every email the API "sent" during the test. */
  const outbox: MailMessage[] = [];
  const auth = createAuth(db, env, { send: async (m) => void outbox.push(m) });
  /** Push messages "sent" by the API (never reaches Expo in tests). Set `pushError` to fail a token. */
  const pushes: PushMessage[] = [];
  const pushErrors = new Map<string, string>();
  const push: PushSender = {
    async send(messages) {
      pushes.push(...messages);
      return messages.map((m): PushTicket => {
        const error = pushErrors.get(m.to);
        return error ? { status: 'error', message: error, details: { error } } : { status: 'ok', id: m.to };
      });
    },
  };
  const toyyibpay = fakeToyyibPay();
  const app = createApp({ db, auth, env, push, toyyibpay });

  return {
    db,
    app,
    outbox,
    pushes,
    pushErrors,
    toyyibpay,
    env,
    async reset() {
      outbox.length = 0;
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
    /** Any method, JSON body, as a logged-in user. */
    send(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, cookie: string, body?: unknown) {
      return app.request(path, {
        method,
        headers: { 'content-type': 'application/json', origin: WEB_ORIGIN, cookie },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    },
    /** Creates a login + credential account (no membership). */
    async createUser(name: string, email: string, password = 'password123'): Promise<number> {
      const [u] = await db.insert(users).values({ name, email }).returning({ id: users.id });
      await db
        .insert(accounts)
        .values({ userId: u!.id, accountId: String(u!.id), providerId: 'credential', password: await hashPassword(password) });
      return u!.id;
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

/** ToyyibPay stand-in: keys starting with "bad" are rejected; `pay()` simulates the customer paying a bill. */
export function fakeToyyibPay() {
  let seq = 0;
  const bills = new Map<string, { input: CreateBillInput; txs: BillTransaction[] }>();
  const categories: { key: string; name: string }[] = [];
  const client: ToyyibPayClient & {
    bills: typeof bills;
    categories: typeof categories;
    pay: (billCode: string, amountSen?: number, status?: string) => void;
  } = {
    bills,
    categories,
    async createCategory(key, name) {
      if (key.startsWith('bad')) throw new ToyyibPayError('[KEY-DID-NOT-EXIST]');
      categories.push({ key, name });
      return `cat${++seq}`;
    },
    async createBill(input) {
      const code = `bill${++seq}`;
      bills.set(code, { input, txs: [] });
      return code;
    },
    async getBillTransactions(billCode) {
      return bills.get(billCode)?.txs ?? [];
    },
    paymentUrl: (code) => `https://dev.toyyibpay.test/${code}`,
    pay(billCode, amountSen, status = '1') {
      const bill = bills.get(billCode);
      if (!bill) throw new Error(`no bill ${billCode}`);
      bill.txs.push({
        billpaymentStatus: status,
        billpaymentAmount: ((amountSen ?? bill.input.amountSen) / 100).toFixed(2),
        billpaymentInvoiceNo: `TP${seq}`,
        billpaymentChannel: 'FPX',
      });
    },
  };
  return client;
}
