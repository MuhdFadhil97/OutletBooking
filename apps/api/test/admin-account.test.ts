import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, like, sql } from 'drizzle-orm';
import { adminAuditLog, platformAdmins, sessions, twoFactors, users, verifications } from '@outletbooking/db';
import { type AdminAccount } from '@outletbooking/shared';
import { describeDevice } from '../src/services/device';
import { cookiesOf, createTestContext, signupInput, totpCode } from './helpers';

/** I29 · My account: password, backup codes, move two-step to a new phone, devices, 8-hour idle sign-out. */
const ctx = createTestContext();
const EMAIL = 'admin@ftech.my';
const PASSWORD = 'password123';
const NEW_PASSWORD = 'a-much-longer-password-1';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const HOUR = 3_600_000;

let adminId = 0;
let totpUri = '';
let backupCodes: string[] = [];
let password = PASSWORD;

const errCode = async (res: Response) => {
  const body = (await res.json()) as { error?: { code: string }; code?: string };
  return body.error?.code ?? body.code;
};
const post = (path: string, body: unknown, cookie: string, headers: Record<string, string> = {}) =>
  ctx.post(path, body, { cookie, ...headers });
const account = async (cookie: string) => {
  const res = await ctx.get('/admin/account', cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as AdminAccount;
};
const auditActions = async (action: string) =>
  (await ctx.db.select().from(adminAuditLog).where(eq(adminAuditLog.adminUserId, adminId)).orderBy(adminAuditLog.id)).filter(
    (a) => a.action === action,
  );

/** Password step then authenticator code, like the real sign-in page. */
async function signIn(opts: { userAgent?: string; code?: string; backup?: string } = {}): Promise<{ cookie: string; status: number }> {
  const headers: Record<string, string> = {};
  if (opts.userAgent) headers['user-agent'] = opts.userAgent;
  const first = await ctx.post('/api/auth/sign-in/email', { email: EMAIL, password }, headers);
  expect(first.status).toBe(200);
  const challenge = cookiesOf(first);
  const res = opts.backup
    ? await post('/api/auth/two-factor/verify-backup-code', { code: opts.backup }, challenge, headers)
    : await post('/api/auth/two-factor/verify-totp', { code: opts.code ?? totpCode(totpUri) }, challenge, headers);
  return { cookie: cookiesOf(res), status: res.status };
}
const sessionOf = async (cookie: string) => (await account(cookie)).devices.find((d) => d.current)!;

/** sessions.updated_at is forced to now() by a trigger; the idle tests need to set it themselves. */
async function setSession(id: number, values: Partial<typeof sessions.$inferInsert>) {
  await ctx.db.execute(sql`alter table sessions disable trigger sessions_set_updated_at`);
  try {
    await ctx.db.update(sessions).set(values).where(eq(sessions.id, id));
  } finally {
    await ctx.db.execute(sql`alter table sessions enable trigger sessions_set_updated_at`);
  }
}

let main = '';

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'owner@example.com', slug: 'acct-owner' }))).status).toBe(201);
  adminId = await ctx.createUser('FTech Admin', EMAIL);
  // A support admin: My account is for every admin, not only super admins.
  await ctx.db.insert(platformAdmins).values({ userId: adminId, role: 'support' });

  // Real two-step setup, like I6.
  const setup = cookiesOf(await ctx.post('/api/auth/sign-in/email', { email: EMAIL, password }));
  const enable = await post('/api/auth/two-factor/enable', { password }, setup);
  expect(enable.status).toBe(200);
  const body = (await enable.json()) as { totpURI: string; backupCodes: string[] };
  totpUri = body.totpURI;
  backupCodes = body.backupCodes;
  const verified = await post('/api/auth/two-factor/verify-totp', { code: totpCode(totpUri) }, setup);
  expect(verified.status).toBe(200);
  main = cookiesOf(verified);
});

beforeEach(async () => {
  await ctx.db.delete(verifications).where(like(verifications.identifier, 'admin-sign-in-failures-%'));
  await ctx.db.delete(verifications).where(like(verifications.identifier, 'admin-2fa-move:%'));
  await ctx.db.update(twoFactors).set({ failedVerificationCount: 0, lockedUntil: null });
});

afterAll(() => ctx.close());

describe('describeDevice', () => {
  it('names the browser and the system', () => {
    expect(describeDevice(CHROME)).toBe('Chrome · Windows');
    expect(describeDevice(SAFARI_IPHONE)).toBe('Safari · iOS');
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Edge · Windows');
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/131.0')).toBe('Firefox · macOS');
    expect(describeDevice('curl/8.0')).toBe('Browser · Unknown system');
    expect(describeDevice(null)).toBe('Unknown device');
  });
});

describe('access', () => {
  it('needs an admin session; owners are refused', async () => {
    expect((await ctx.get('/admin/account')).status).toBe(401);
    const owner = await ctx.login('owner@example.com', PASSWORD);
    expect((await ctx.get('/admin/account', owner)).status).toBe(403);
  });

  it('shows the profile, two-step status, backup codes left and this device', async () => {
    const a = await account(main);
    expect(a).toMatchObject({
      name: 'FTech Admin',
      email: EMAIL,
      role: 'support',
      twoFactorEnabled: true,
      backupCodesLeft: 10,
      backupCodesTotal: 10,
    });
    expect(a.devices.filter((d) => d.current)).toHaveLength(1);
    expect(JSON.stringify(a)).not.toMatch(/secret|totpUri|backupCodes":\[/);
  });

  it('lists every signed-in device with a readable name; using a backup code lowers the count', async () => {
    const phone = await signIn({ userAgent: SAFARI_IPHONE, backup: backupCodes[0]! });
    expect(phone.status).toBe(200);
    const a = await account(main);
    expect(a.backupCodesLeft).toBe(9);
    expect(a.devices.map((d) => d.device)).toContain('Safari · iOS');
    expect(a.devices.length).toBeGreaterThanOrEqual(2);
    backupCodes = backupCodes.slice(1);
    await post('/admin/account/devices/sign-out-others', {}, main);
  });
});

describe('change password', () => {
  const LONG = 'password123-long';

  it('needs 12+ characters and a different password from the current one', async () => {
    const path = '/admin/account/password';
    expect((await post(path, { currentPassword: PASSWORD, newPassword: 'short' }, main)).status).toBe(400);
    expect((await post(path, { currentPassword: PASSWORD }, main)).status).toBe(400);
    expect((await post(path, { currentPassword: PASSWORD, newPassword: LONG }, main)).status).toBe(200);
    password = LONG;
    const same = await post(path, { currentPassword: LONG, newPassword: LONG }, main);
    expect(same.status).toBe(400);
    expect(await errCode(same)).toBe('same_password');
  });

  it('a wrong current password is refused, logged, and counts towards the lockout', async () => {
    await ctx.db.delete(adminAuditLog);
    const res = await post('/admin/account/password', { currentPassword: 'nope-nope-nope', newPassword: NEW_PASSWORD }, main);
    expect(res.status).toBe(400);
    expect(await errCode(res)).toBe('wrong_password');
    const failed = await auditActions('sign_in_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ reason: 'Wrong password in My account', details: { step: 'account', failures: 1, locked: false } });

    for (let i = 0; i < 3; i++) {
      await post('/admin/account/password', { currentPassword: 'nope-nope-nope', newPassword: NEW_PASSWORD }, main);
    }
    const locked = await post('/admin/account/password', { currentPassword: 'nope-nope-nope', newPassword: NEW_PASSWORD }, main);
    expect(locked.status).toBe(429);
    expect(await errCode(locked)).toBe('account_locked');
    // Even the right password is refused while locked, and so is signing in.
    expect((await post('/admin/account/password', { currentPassword: password, newPassword: NEW_PASSWORD }, main)).status).toBe(429);
    expect((await ctx.post('/api/auth/sign-in/email', { email: EMAIL, password })).status).toBe(429);
  });

  it('changes it, signs the other devices out, and the new password is the one that works', async () => {
    const other = await signIn({ userAgent: CHROME });
    expect(other.status).toBe(200);
    await ctx.db.delete(adminAuditLog);
    const old = password;

    const res = await post('/admin/account/password', { currentPassword: old, newPassword: NEW_PASSWORD }, main);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { signedOutDevices: number }).signedOutDevices).toBeGreaterThanOrEqual(1);
    expect((await ctx.get('/admin/account', main)).status).toBe(200);
    expect((await ctx.get('/admin/account', other.cookie)).status).toBe(401);
    expect((await ctx.post('/api/auth/sign-in/email', { email: EMAIL, password: old })).status).toBe(401);
    expect((await ctx.post('/api/auth/sign-in/email', { email: EMAIL, password: NEW_PASSWORD })).status).toBe(200);
    expect(await auditActions('change_password')).toHaveLength(1);
    password = NEW_PASSWORD;
  });
});

describe('new backup codes', () => {
  it('asks for the password; the old codes stop working and the new ones work once', async () => {
    const path = '/admin/account/backup-codes';
    expect(await errCode(await post(path, { password: 'wrong-password-1' }, main))).toBe('wrong_password');

    const res = await post(path, { password }, main);
    expect(res.status).toBe(200);
    const fresh = ((await res.json()) as { backupCodes: string[] }).backupCodes;
    expect(fresh).toHaveLength(10);
    expect(new Set(fresh).size).toBe(10);
    expect((await account(main)).backupCodesLeft).toBe(10);

    // Old code: refused by Better Auth. New code: accepted once.
    expect((await signIn({ backup: backupCodes[0]! })).status).toBe(401);
    expect((await signIn({ backup: fresh[0]! })).status).toBe(200);
    expect((await account(main)).backupCodesLeft).toBe(9);
    backupCodes = fresh.slice(1);

    expect(await auditActions('new_backup_codes')).toHaveLength(1);
    // The codes are never written to the audit log.
    expect(JSON.stringify(await auditActions('new_backup_codes'))).not.toContain(fresh[1]!);
  });
});

describe('move two-step to a new phone', () => {
  it('the old phone works until the new one is confirmed; then only the new one does', async () => {
    const oldUri = totpUri;
    const start = await post('/admin/account/two-factor/move', { password }, main);
    expect(start.status).toBe(200);
    const body = (await start.json()) as { totpUri: string; expiresAt: string };
    expect(body.totpUri).toMatch(/^otpauth:\/\/totp\/OutletBooking%20Admin:/);
    expect(body.totpUri).not.toBe(oldUri);
    expect(Date.parse(body.expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);

    // Not confirmed yet: the old phone still signs in; the new one does not.
    expect((await signIn({ code: totpCode(body.totpUri) })).status).toBe(401);
    expect((await signIn({ code: totpCode(oldUri) })).status).toBe(200);

    const wrong = await post('/admin/account/two-factor/move/confirm', { code: '000000' }, main);
    expect(wrong.status).toBe(400);
    expect(await errCode(wrong)).toBe('wrong_code');
    expect((await post('/admin/account/two-factor/move/confirm', { code: 'abc' }, main)).status).toBe(400);

    const other = await signIn({ userAgent: CHROME, code: totpCode(oldUri) });
    expect(other.status).toBe(200);
    await ctx.db.delete(adminAuditLog);

    const ok = await post('/admin/account/two-factor/move/confirm', { code: totpCode(body.totpUri) }, main);
    expect(ok.status).toBe(200);
    const done = (await ok.json()) as { backupCodes: string[]; signedOutDevices: number };
    expect(done.backupCodes).toHaveLength(10);
    expect(done.signedOutDevices).toBeGreaterThanOrEqual(1);
    expect((await ctx.get('/admin/account', other.cookie)).status).toBe(401);
    expect((await ctx.get('/admin/account', main)).status).toBe(200);

    // Better Auth itself: old phone refused, new phone accepted, old backup codes gone.
    expect((await signIn({ code: totpCode(oldUri) })).status).toBe(401);
    expect((await signIn({ backup: backupCodes[0]! })).status).toBe(401);
    expect((await signIn({ code: totpCode(body.totpUri) })).status).toBe(200);
    expect((await signIn({ backup: done.backupCodes[0]! })).status).toBe(200);
    totpUri = body.totpUri;
    backupCodes = done.backupCodes.slice(1);

    expect(await auditActions('move_two_factor')).toHaveLength(1);
    // The pending secret is gone.
    expect(await ctx.db.select().from(verifications).where(like(verifications.identifier, 'admin-2fa-move:%'))).toHaveLength(0);
  });

  it('asks for the password first, and a confirm without a start is refused', async () => {
    expect(await errCode(await post('/admin/account/two-factor/move', { password: 'wrong-password-1' }, main))).toBe('wrong_password');
    const res = await post('/admin/account/two-factor/move/confirm', { code: totpCode(totpUri) }, main);
    expect(res.status).toBe(410);
    expect(await errCode(res)).toBe('move_expired');
  });

  it('five wrong codes throw the setup away; a timed-out setup is refused', async () => {
    const start = await post('/admin/account/two-factor/move', { password }, main);
    const { totpUri: fresh } = (await start.json()) as { totpUri: string };
    for (let i = 0; i < 4; i++) {
      expect((await post('/admin/account/two-factor/move/confirm', { code: '000000' }, main)).status).toBe(400);
    }
    const fifth = await post('/admin/account/two-factor/move/confirm', { code: '000000' }, main);
    expect(fifth.status).toBe(410);
    // Even the right code no longer works: start again.
    expect((await post('/admin/account/two-factor/move/confirm', { code: totpCode(fresh) }, main)).status).toBe(410);

    await post('/admin/account/two-factor/move', { password }, main);
    await ctx.db.update(verifications).set({ expiresAt: new Date(Date.now() - 1000) }).where(like(verifications.identifier, 'admin-2fa-move:%'));
    expect(await errCode(await post('/admin/account/two-factor/move/confirm', { code: '123456' }, main))).toBe('move_expired');
    // Nothing changed for sign-in.
    expect((await signIn()).status).toBe(200);
  });
});

describe('signed-in devices', () => {
  it('signs one device out, or all the others; never your own, never someone else’s', async () => {
    await ctx.db.delete(adminAuditLog);
    const a = await signIn({ userAgent: CHROME });
    const b = await signIn({ userAgent: SAFARI_IPHONE });
    const mine = await sessionOf(main);
    const aId = (await sessionOf(a.cookie)).id;

    expect(await errCode(await post(`/admin/account/devices/${mine.id}/sign-out`, {}, main))).toBe('not_yourself');
    expect((await post('/admin/account/devices/999999/sign-out', {}, main)).status).toBe(404);

    // Another admin's session is a 404, not a sign-out.
    const otherId = await ctx.createUser('Other Admin', 'other@ftech.my');
    await ctx.db.insert(platformAdmins).values({ userId: otherId, role: 'support' });
    await ctx.login('other@ftech.my', PASSWORD);
    const [theirs] = await ctx.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, otherId));
    expect((await post(`/admin/account/devices/${theirs!.id}/sign-out`, {}, main)).status).toBe(404);
    expect(await ctx.db.select().from(sessions).where(eq(sessions.userId, otherId))).toHaveLength(1);

    expect((await post(`/admin/account/devices/${aId}/sign-out`, {}, main)).status).toBe(200);
    expect((await ctx.get('/admin/account', a.cookie)).status).toBe(401);
    expect((await ctx.get('/admin/account', b.cookie)).status).toBe(200);

    const remaining = (await account(main)).devices.length;
    const all = await post('/admin/account/devices/sign-out-others', {}, main);
    expect(all.status).toBe(200);
    expect(((await all.json()) as { signedOut: number }).signedOut).toBe(remaining - 1);
    expect((await ctx.get('/admin/account', b.cookie)).status).toBe(401);
    expect((await ctx.get('/admin/account', main)).status).toBe(200);
    expect((await account(main)).devices).toHaveLength(1);

    expect((await auditActions('sign_out_devices')).map((r) => r.reason)).toEqual(['Signed out a device', 'Signed out all other devices']);
    // Nothing to sign out: fine, and no audit row.
    const none = await post('/admin/account/devices/sign-out-others', {}, main);
    expect(((await none.json()) as { signedOut: number }).signedOut).toBe(0);
    expect(await auditActions('sign_out_devices')).toHaveLength(2);
  });
});

describe('8-hour idle sign-out', () => {
  const sessionRow = async (cookie: string) => {
    const id = (await sessionOf(cookie)).id;
    return (await ctx.db.select().from(sessions).where(eq(sessions.id, id)))[0]!;
  };

  it('a session unused for more than 8 hours is signed out, even if Better Auth would have refreshed it', async () => {
    const idle = await signIn();
    const id = (await sessionRow(idle.cookie)).id;
    // 2 days into a 30-day session, last used 9 hours ago: Better Auth's own daily refresh is due.
    await setSession(id, {
      updatedAt: new Date(Date.now() - 9 * HOUR),
      createdAt: new Date(Date.now() - 48 * HOUR),
      expiresAt: new Date(Date.now() + 28 * 24 * HOUR),
    });

    const res = await ctx.get('/admin/me', idle.cookie);
    expect(res.status).toBe(401);
    expect(await errCode(res)).toBe('session_idle_expired');
    expect(await ctx.db.select().from(sessions).where(eq(sessions.id, id))).toHaveLength(0);
    expect((await ctx.get('/admin/me', idle.cookie)).status).toBe(401);
  });

  it('use within 8 hours keeps the session alive and moves "last active" forward', async () => {
    const live = await signIn();
    const row = await sessionRow(live.cookie);
    await setSession(row.id, { updatedAt: new Date(Date.now() - 7 * HOUR) });

    expect((await ctx.get('/admin/me', live.cookie)).status).toBe(200);
    const after = (await ctx.db.select().from(sessions).where(eq(sessions.id, row.id)))[0]!;
    expect(Date.now() - after.updatedAt.getTime()).toBeLessThan(60_000);

    // Used again straight away: not written again (at most once a minute).
    const stamp = after.updatedAt.getTime();
    expect((await ctx.get('/admin/me', live.cookie)).status).toBe(200);
    const again = (await ctx.db.select().from(sessions).where(eq(sessions.id, row.id)))[0]!;
    expect(again.updatedAt.getTime()).toBe(stamp);
  });
});

describe('my account never touches other admins', () => {
  it('the password change only changes the signed-in admin', async () => {
    const [other] = await ctx.db.select().from(users).where(eq(users.email, 'other@ftech.my'));
    expect(other).toBeDefined();
    expect((await ctx.post('/api/auth/sign-in/email', { email: 'other@ftech.my', password: PASSWORD })).status).toBe(200);
  });
});
