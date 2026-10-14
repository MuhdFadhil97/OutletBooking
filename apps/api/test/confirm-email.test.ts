import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createEmailVerificationToken } from 'better-auth/api';
import { adminAuditLog, businesses, platformAdmins, users } from '@outletbooking/db';
import type { AdminBusinessDetail } from '@outletbooking/shared';
import { settleBackground } from '../src/background';
import { confirmEmail } from '../src/services/confirm-email';
import { createTestContext, signupInput } from './helpers';

/** M1 · confirm email after sign-up (Email-Verify.dc.html), and the I2 "Resend confirm email" button. */
const ctx = createTestContext();
let admin = '';
let bizId = 0;

const verified = async (email = 'ali@example.com') =>
  (await ctx.db.select({ v: users.emailVerified }).from(users).where(eq(users.email, email)))[0]!.v;
const linkIn = (text: string) => new URL(text.match(/Confirm email: (\S+)/)![1]!);
/** Follow the link through the real app (Better Auth's /api/auth/verify-email). */
const open = (url: URL) => ctx.app.request(`${url.pathname}${url.search}`);
const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

beforeAll(async () => {
  await ctx.reset();
  const adminId = await ctx.createUser('FTech Admin', 'admin@ftech.my');
  await ctx.db.insert(platformAdmins).values({ userId: adminId });
  admin = await ctx.login('admin@ftech.my', 'password123');
  // /admin needs two-step sign-in on (the real flow is tested in admin-sign-in.test.ts).
  await ctx.db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, adminId));
});

beforeEach(async () => {
  await ctx.db.delete(users).where(eq(users.email, 'ali@example.com'));
  await ctx.db.delete(businesses);
  ctx.outbox.length = 0;
  expect((await ctx.post('/signup', signupInput({ businessName: 'Smash Arena PJ' }))).status).toBe(201);
  await settleBackground();
  bizId = (await ctx.db.select({ id: businesses.id }).from(businesses))[0]!.id;
});

afterAll(() => ctx.close());

describe('M1 sent after sign-up', () => {
  it('emails the owner a confirm link (HTML from the shared template + plain text)', async () => {
    expect(ctx.outbox).toHaveLength(1);
    const mail = ctx.outbox[0]!;
    expect(mail).toMatchObject({ to: 'ali@example.com', subject: 'Confirm your email' });
    expect(mail.text).toContain('thanks for starting your free trial for Smash Arena PJ');
    expect(mail.text).toContain('This link expires in 24 hours.');
    expect(mail.html).toContain('<b>Smash Arena PJ</b>');
    expect(mail.html).toContain('Confirm email</a>');
    expect(mail.html).toContain('https://outletbooking.my/privacy');

    const url = linkIn(mail.text);
    expect(url.pathname).toBe('/api/auth/verify-email');
    expect(url.searchParams.get('callbackURL')).toBe('http://localhost:8081');
    expect(mail.html).toContain(url.toString().replace(/&/g, '&amp;'));
  });

  it('the link confirms the email and opens the app', async () => {
    expect(await verified()).toBe(false);
    const res = await open(linkIn(ctx.outbox[0]!.text));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:8081');
    expect(await verified()).toBe(true);
  });

  it('an expired or changed link does not confirm, and the app is told why', async () => {
    const url = linkIn(ctx.outbox[0]!.text);
    const expired = new URL(url);
    expired.searchParams.set('token', await createEmailVerificationToken(ctx.env.BETTER_AUTH_SECRET, 'ali@example.com', undefined, -60));
    expect((await open(expired)).headers.get('location')).toBe('http://localhost:8081/?error=TOKEN_EXPIRED');

    const changed = new URL(url);
    changed.searchParams.set('token', `${url.searchParams.get('token')}x`);
    expect((await open(changed)).headers.get('location')).toBe('http://localhost:8081/?error=INVALID_TOKEN');
    expect(await verified()).toBe(false);
  });

  it('the template escapes names typed by the owner', () => {
    const mail = confirmEmail('<Ali>', 'Fun & <b>Games</b>', 'https://api.test/x?a=1&b=2', 'https://outletbooking.my');
    expect(mail.html).toContain('Fun &amp; &lt;b&gt;Games&lt;/b&gt;');
    expect(mail.html).toContain('Hi &lt;Ali&gt;');
    expect(mail.html).not.toContain('<b>Games</b>');
    expect(mail.html).toContain('href="https://api.test/x?a=1&amp;b=2"');
  });
});

describe('I2 resend confirm email', () => {
  it('sends M1 again with the reason in the audit log, until the owner has confirmed', async () => {
    const path = `/admin/businesses/${bizId}/confirm-email`;
    ctx.outbox.length = 0;
    expect((await ctx.send('POST', path, admin, {})).status).toBe(400);

    const res = await ctx.send('POST', path, admin, { reason: 'Owner never got the first email' });
    expect(res.status).toBe(200);
    expect(ctx.outbox.map((m) => [m.to, m.subject])).toEqual([['ali@example.com', 'Confirm your email']]);
    expect(((await res.json()) as AdminBusinessDetail).auditLog[0]).toMatchObject({
      action: 'resend_link',
      details: { link: 'confirm_email' },
    });

    await open(linkIn(ctx.outbox[0]!.text));
    expect(await errCode(await ctx.send('POST', path, admin, { reason: 'Again' }))).toBe('already_confirmed');
    expect(await ctx.db.select().from(adminAuditLog).where(eq(adminAuditLog.businessId, bizId))).toHaveLength(1);
  });

  it('owners cannot call it', async () => {
    const owner = await ctx.login('ali@example.com', 'password123');
    expect((await ctx.send('POST', `/admin/businesses/${bizId}/confirm-email`, owner, { reason: 'Me' })).status).toBe(403);
  });
});
