import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { sessions, users, verifications } from '@outletbooking/db';
import { createTestContext, signupInput } from './helpers';

const ctx = createTestContext();

beforeEach(async () => {
  await ctx.reset();
  await ctx.db.delete(verifications);
  expect((await ctx.post('/signup', signupInput())).status).toBe(201);
});
afterAll(() => ctx.close());

/** Asks for a reset email and returns the token from the link inside it. */
async function requestToken(email = 'ali@example.com'): Promise<string> {
  const res = await ctx.post('/password/forgot', { email });
  expect(res.status).toBe(200);
  const mail = ctx.outbox.at(-1);
  expect(mail?.to).toBe('ali@example.com');
  const link = mail!.text.match(/https?:\/\/\S+/)?.[0];
  expect(link).toBeDefined();
  const url = new URL(link!);
  expect(url.pathname).toBe('/reset-password');
  return url.searchParams.get('token')!;
}

const userSessions = async () => {
  const [u] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, 'ali@example.com'));
  return ctx.db.select().from(sessions).where(eq(sessions.userId, u!.id));
};

describe('E1 · POST /password/forgot', () => {
  it('emails a link to the app reset screen that works for 30 minutes', async () => {
    const before = Date.now();
    const token = await requestToken();
    expect(ctx.outbox[0]!.text).toContain('http://localhost:8081/reset-password?token=');
    expect(ctx.outbox[0]!.text).toContain('30 minutes');

    const [row] = await ctx.db.select().from(verifications).where(eq(verifications.identifier, `reset-password:${token}`));
    const minutes = (row!.expiresAt.getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(29.9);
    expect(minutes).toBeLessThan(30.1);
  });

  it('answers the same for an unknown email and sends nothing (no account enumeration)', async () => {
    const res = await ctx.post('/password/forgot', { email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(ctx.outbox).toHaveLength(0);
  });

  it('matches the email case-insensitively', async () => {
    await requestToken('ALI@Example.com');
  });

  it('rejects an invalid email with 400', async () => {
    expect((await ctx.post('/password/forgot', { email: 'not-an-email' })).status).toBe(400);
  });
});

describe('E2 · reset with the emailed token', () => {
  it('GET /password/reset/:token tells whose account it is', async () => {
    const token = await requestToken();
    const res = await ctx.get(`/password/reset/${token}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: 'ali@example.com' });
  });

  it('sets the new password: new one logs in, old one does not', async () => {
    const token = await requestToken();
    const res = await ctx.post('/password/reset', { token, newPassword: 'brand-new-pass', logoutOtherDevices: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: 'ali@example.com' });

    await expect(ctx.login('ali@example.com', 'password123')).rejects.toThrow(/login failed/);
    await ctx.login('ali@example.com', 'brand-new-pass');
  });

  it('logs out every other device when asked (default)', async () => {
    const oldCookie = await ctx.login('ali@example.com', 'password123');
    expect(await userSessions()).toHaveLength(1);

    const token = await requestToken();
    expect((await ctx.post('/password/reset', { token, newPassword: 'brand-new-pass' })).status).toBe(200);

    expect(await userSessions()).toHaveLength(0);
    expect((await ctx.get('/me', oldCookie)).status).toBe(401);
  });

  it('keeps other devices logged in when "log out other devices" is off', async () => {
    const oldCookie = await ctx.login('ali@example.com', 'password123');
    const token = await requestToken();
    expect((await ctx.post('/password/reset', { token, newPassword: 'brand-new-pass', logoutOtherDevices: false })).status).toBe(200);
    expect((await ctx.get('/me', oldCookie)).status).toBe(200);
  });

  it('a token works only once', async () => {
    const token = await requestToken();
    expect((await ctx.post('/password/reset', { token, newPassword: 'brand-new-pass' })).status).toBe(200);

    const again = await ctx.post('/password/reset', { token, newPassword: 'another-pass-1' });
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe('invalid_reset_link');
    expect((await ctx.get(`/password/reset/${token}`)).status).toBe(400);
  });

  it('rejects an expired token', async () => {
    const token = await requestToken();
    await ctx.db
      .update(verifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verifications.identifier, `reset-password:${token}`));

    expect((await ctx.get(`/password/reset/${token}`)).status).toBe(400);
    expect((await ctx.post('/password/reset', { token, newPassword: 'brand-new-pass' })).status).toBe(400);
    await ctx.login('ali@example.com', 'password123'); // unchanged
  });

  it('rejects an unknown token and a too-short password', async () => {
    const unknown = await ctx.post('/password/reset', { token: 'abcdefghijklmnopqrstuvwx', newPassword: 'brand-new-pass' });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe('invalid_reset_link');

    const token = await requestToken();
    const short = await ctx.post('/password/reset', { token, newPassword: 'short' });
    expect(short.status).toBe(400);
    expect(((await short.json()) as { error: { code: string } }).error.code).toBe('validation_error');
    // The token was not used up by the invalid attempt.
    expect((await ctx.get(`/password/reset/${token}`)).status).toBe(200);
  });
});

describe('H6 · change password (Better Auth)', () => {
  it('needs the current password and can log out other devices', async () => {
    const otherDevice = await ctx.login('ali@example.com', 'password123');
    const cookie = await ctx.login('ali@example.com', 'password123');

    const wrong = await ctx.send('POST', '/api/auth/change-password', cookie, {
      currentPassword: 'wrong-password',
      newPassword: 'brand-new-pass',
    });
    expect(wrong.status).toBe(400);

    const res = await ctx.send('POST', '/api/auth/change-password', cookie, {
      currentPassword: 'password123',
      newPassword: 'brand-new-pass',
      revokeOtherSessions: true,
    });
    expect(res.status).toBe(200);
    expect((await ctx.get('/me', otherDevice)).status).toBe(401);
    await ctx.login('ali@example.com', 'brand-new-pass');
  });
});
