import { eq, sql as dsql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { accounts, businesses, createDb, paymentAccounts, users } from '@outletbooking/db';
import { encryptSecret } from '../src/services/crypto';
import type { SignupInput } from '@outletbooking/shared';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { loadEnv } from '../src/env';
import type { MailMessage } from '../src/services/mailer';
import type { PushMessage } from '../src/services/push';
import { ToyyibPayError, type BillTransaction, type CreateBillInput, type ToyyibPayClient } from '../src/services/toyyibpay';

/** In-memory ToyyibPay: records categories / bills; tests decide what each bill's transactions say. */
export class FakeToyyibPay implements ToyyibPayClient {
  categories: { secretKey: string; name: string }[] = [];
  bills = new Map<string, CreateBillInput & { secretKey: string; txs: BillTransaction[] }>();
  /** Keys ToyyibPay rejects. */
  badKeys = new Set<string>(['bad-key-0000']);
  down = false;
  private n = 0;

  async createCategory(secretKey: string, name: string) {
    if (this.down) throw new ToyyibPayError('Could not reach ToyyibPay. Try again in a minute.');
    if (this.badKeys.has(secretKey)) throw new ToyyibPayError('ToyyibPay did not accept this key ([KEY-DID-NOT-EXIST])');
    this.categories.push({ secretKey, name });
    return `cat${this.categories.length}`;
  }
  async createBill(secretKey: string, input: CreateBillInput) {
    if (this.down) throw new ToyyibPayError('Could not reach ToyyibPay. Try again in a minute.');
    const code = `bill${++this.n}x`;
    this.bills.set(code, { ...input, secretKey, txs: [] });
    return code;
  }
  async getBillTransactions(billCode: string) {
    if (this.down) throw new ToyyibPayError('Could not reach ToyyibPay. Try again in a minute.');
    return this.bills.get(billCode)?.txs ?? [];
  }
  paymentUrl(billCode: string) {
    return `https://dev.toyyibpay.test/${billCode}`;
  }
  /** The customer pays (or fails) at the bank. */
  pay(billCode: string, amountSen?: number) {
    const bill = this.bills.get(billCode)!;
    bill.txs = [{ status: 'paid', amountSen: amountSen ?? bill.amountSen, invoiceNo: `TP${billCode}`, channel: 'FPX', paidAt: null }];
  }
  fail(billCode: string) {
    this.bills.get(billCode)!.txs = [{ status: 'failed', amountSen: this.bills.get(billCode)!.amountSen, invoiceNo: null, channel: 'FPX', paidAt: null }];
  }
  lastBill() {
    return [...this.bills.keys()].at(-1)!;
  }
}
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
  });
  const { db, sql } = createDb(url, { max: 5 });
  /** Every email the API "sent" during the test. */
  const outbox: MailMessage[] = [];
  const auth = createAuth(db, env, { send: async (m) => void outbox.push(m) });
  /** Every push the API "sent"; tokens containing "Dead" come back as unregistered. */
  const pushed: PushMessage[] = [];
  const push = {
    async send(messages: PushMessage[]) {
      pushed.push(...messages);
      return { deadTokens: messages.filter((m) => m.to.includes('Dead')).map((m) => m.to) };
    },
  };
  const toyyibpay = new FakeToyyibPay();
  const app = createApp({ db, auth, env, push, toyyibpay });

  return {
    db,
    app,
    outbox,
    pushed,
    toyyibpay,
    async reset() {
      outbox.length = 0;
      pushed.length = 0;
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
    /** Marks a business as having connected ToyyibPay (secret key "sk-<slug>", category "CAT-<slug>"). */
    async connectOnlinePayments(slug: string) {
      const [b] = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, slug));
      const secretKey = `sk-${slug}`;
      await db.insert(paymentAccounts).values({
        businessId: b!.id,
        status: 'connected',
        secretKeyEncrypted: encryptSecret(secretKey, Buffer.from(env.APP_ENCRYPTION_KEY!, 'base64')),
        secretKeyLast4: secretKey.slice(-4),
        categoryCode: `CAT-${slug}`,
      });
      return b!.id;
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
