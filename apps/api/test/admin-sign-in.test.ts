import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, like } from 'drizzle-orm';
import { adminAuditLog, platformAdmins, twoFactors, users, verifications } from '@outletbooking/db';
import { ADMIN_AUTH_ERRORS, type AdminMe } from '@outletbooking/shared';
import { cookiesOf, createTestContext, signupInput, totpCode } from './helpers';

/** I5 + I6: admin sign-in with password + required two-step code; lockout after 5 wrong tries; every sign-in logged. */
const ctx = createTestContext();
const EMAIL = 'admin@ftech.my';
const PASSWORD = 'password123';

let adminId = 0;
let totpUri = '';
let backupCodes: string[] = [];

const errCode = async (res: Response) => {
  const body = (await res.json()) as { error?: { code: string }; code?: string };
  return body.error?.code ?? body.code;
};
const signIn = (password = PASSWORD, email = EMAIL) => ctx.post('/api/auth/sign-in/email', { email, password });
const post = (path: string, body: unknown, cookie: string) => ctx.post(path, body, { cookie });
const auditOf = (action: 'sign_in' | 'sign_in_failed') =>
  ctx.db
    .select()
    .from(adminAuditLog)
    .where(and(eq(adminAuditLog.adminUserId, adminId), eq(adminAuditLog.action, action)));

/** Password step for an admin with two-step on: no session yet, only the two-step challenge cookie. */
async function passwordStep(): Promise<string> {
  const res = await signIn();
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ twoFactorRedirect: true });
  return cookiesOf(res);
}

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'owner@example.com', slug: 'sign-in-owner' }))).status).toBe(201);
  adminId = await ctx.createUser('FTech Admin', EMAIL);
  await ctx.db.insert(platformAdmins).values({ userId: adminId, role: 'super_admin' });
});

beforeEach(async () => {
  await ctx.db.delete(verifications).where(like(verifications.identifier, 'admin-sign-in-failures-%'));
  await ctx.db.update(twoFactors).set({ failedVerificationCount: 0, lockedUntil: null });
});

afterAll(() => ctx.close());

describe('I6 first sign-in: set up two-step', () => {
  it('a password-only session cannot use /admin until two-step is set up', async () => {
    const res = await signIn();
    expect(res.status).toBe(200);
    const me = await ctx.get('/admin/me', cookiesOf(res));
    expect(me.status).toBe(403);
    expect(await errCode(me)).toBe(ADMIN_AUTH_ERRORS.twoFactorSetupRequired);
  });

  it('scan the QR code, save 10 backup codes, enter a code → signed in; older sessions are signed out', async () => {
    const older = cookiesOf(await signIn()); // e.g. a session from before two-step was on
    const setup = cookiesOf(await signIn());

    const enable = await post('/api/auth/two-factor/enable', { password: PASSWORD }, setup);
    expect(enable.status).toBe(200);
    const body = (await enable.json()) as { totpURI: string; backupCodes: string[] };
    totpUri = body.totpURI;
    backupCodes = body.backupCodes;
    expect(totpUri).toMatch(/^otpauth:\/\/totp\/OutletBooking%20Admin:/);
    expect(backupCodes).toHaveLength(10);
    // Not on until a code is entered.
    expect((await ctx.get('/admin/me', setup)).status).toBe(403);

    expect((await post('/api/auth/two-factor/verify-totp', { code: '000000' }, setup)).status).toBe(401);
    const verify = await post('/api/auth/two-factor/verify-totp', { code: totpCode(totpUri) }, setup);
    expect(verify.status).toBe(200);
    const session = cookiesOf(verify);

    const me = await ctx.get('/admin/me', session);
    expect(me.status).toBe(200);
    expect((await me.json()) as AdminMe).toEqual({ userId: adminId, name: 'FTech Admin', email: EMAIL, role: 'super_admin' });
    expect((await ctx.get('/admin/me', setup)).status).toBe(401);
    expect((await ctx.get('/admin/me', older)).status).toBe(401);

    const [log] = await auditOf('sign_in');
    expect(log).toMatchObject({ reason: 'Signed in and set up two-step sign-in', details: { method: 'totp', firstSetup: true } });
  });

  it('two-step cannot be turned off', async () => {
    const cookie = cookiesOf(
      await post('/api/auth/two-factor/verify-totp', { code: totpCode(totpUri) }, await passwordStep()),
    );
    const res = await post('/api/auth/two-factor/disable', { password: PASSWORD }, cookie);
    expect(res.status).toBe(403);
    expect((await ctx.db.select().from(users).where(eq(users.id, adminId)))[0]!.twoFactorEnabled).toBe(true);
  });
});

describe('I5 → I6 sign-in', () => {
  it('password then authenticator code', async () => {
    await ctx.db.delete(adminAuditLog);
    const challenge = await passwordStep();
    expect((await ctx.get('/admin/me', challenge)).status).toBe(401);

    const res = await post('/api/auth/two-factor/verify-totp', { code: totpCode(totpUri) }, challenge);
    expect(res.status).toBe(200);
    expect((await ctx.get('/admin/me', cookiesOf(res))).status).toBe(200);
    const logs = await auditOf('sign_in');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ reason: 'Signed in with a two-step code', details: { method: 'totp', firstSetup: false } });
  });

  it('a backup code works once', async () => {
    const code = backupCodes[0]!;
    const res = await post('/api/auth/two-factor/verify-backup-code', { code }, await passwordStep());
    expect(res.status).toBe(200);
    expect((await ctx.get('/admin/me', cookiesOf(res))).status).toBe(200);
    expect((await auditOf('sign_in')).some((l) => l.details.method === 'backup_code')).toBe(true);

    const again = await post('/api/auth/two-factor/verify-backup-code', { code }, await passwordStep());
    expect(again.status).toBe(401);
  });

  it('5 wrong codes lock the two-step step', async () => {
    const challenge = await passwordStep();
    for (let i = 0; i < 5; i++) {
      expect((await post('/api/auth/two-factor/verify-totp', { code: '000000' }, challenge)).status).toBe(401);
    }
    const res = await post('/api/auth/two-factor/verify-totp', { code: totpCode(totpUri) }, await passwordStep());
    expect(res.status).toBe(429);
  });
});

describe('I5 password lockout', () => {
  it('5 wrong passwords lock the admin login for 15 minutes, each one logged', async () => {
    await ctx.db.delete(adminAuditLog);
    for (let i = 1; i <= 4; i++) expect((await signIn('wrong-password')).status).toBe(401);
    const fifth = await signIn('wrong-password');
    expect(fifth.status).toBe(429);
    expect(await errCode(fifth)).toBe(ADMIN_AUTH_ERRORS.accountLocked);

    // Even the right password is refused while locked.
    const locked = await signIn();
    expect(locked.status).toBe(429);

    const failed = await auditOf('sign_in_failed');
    expect(failed).toHaveLength(5);
    expect(failed.filter((l) => l.details.locked)).toHaveLength(1);

    // 15 minutes later.
    await ctx.db
      .update(verifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verifications.identifier, `admin-sign-in-failures-${adminId}`));
    await passwordStep();
    const left = await ctx.db.select().from(verifications).where(eq(verifications.identifier, `admin-sign-in-failures-${adminId}`));
    expect(left).toHaveLength(0);
  });

  it('a right password resets the count', async () => {
    for (let i = 0; i < 4; i++) expect((await signIn('wrong-password')).status).toBe(401);
    await passwordStep();
    for (let i = 0; i < 4; i++) expect((await signIn('wrong-password')).status).toBe(401);
    await passwordStep();
  });
});

describe('owners and staff are not affected', () => {
  it('no lockout and no two-step step for an owner', async () => {
    for (let i = 0; i < 6; i++) expect((await signIn('wrong-password', 'owner@example.com')).status).toBe(401);
    const res = await signIn(PASSWORD, 'owner@example.com');
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty('twoFactorRedirect');
  });

  it('an owner cannot turn on two-step (the app has no code screen)', async () => {
    const owner = await ctx.login('owner@example.com', PASSWORD);
    expect((await post('/api/auth/two-factor/enable', { password: PASSWORD }, owner)).status).toBe(403);
  });

  it('a deactivated admin loses access', async () => {
    const cookie = cookiesOf(
      await post('/api/auth/two-factor/verify-totp', { code: totpCode(totpUri) }, await passwordStep()),
    );
    await ctx.db.update(platformAdmins).set({ isActive: false }).where(eq(platformAdmins.userId, adminId));
    expect((await ctx.get('/admin/me', cookie)).status).toBe(403);
    await ctx.db.update(platformAdmins).set({ isActive: true }).where(eq(platformAdmins.userId, adminId));
  });
});
