import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { adminAuditLog, platformAdmins, sessions, twoFactors, users, verifications } from '@outletbooking/db';
import type { AdminInviteInfo, AdminUserRow } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

/** I10 · Admin users: super admins invite, change role, reset two-step, remove; every change in the audit log. */
const ctx = createTestContext();

let superCookie = '';
let supportCookie = '';
let superId = 0;
let supportId = 0;

const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const auditOf = async (action: string) =>
  ctx.db
    .select()
    .from(adminAuditLog)
    .where(eq(adminAuditLog.action, action as typeof adminAuditLog.$inferSelect.action))
    .orderBy(adminAuditLog.id);
const rows = async () => {
  const res = await ctx.get('/admin/users', superCookie);
  expect(res.status).toBe(200);
  return (await res.json()) as AdminUserRow[];
};
/** The token from the last invite email's link. */
const lastInviteToken = () => {
  const mail = ctx.outbox.at(-1)!;
  const m = /\/admin\/invite\/([a-f0-9]{48})/.exec(mail.text);
  expect(m).not.toBeNull();
  return m![1]!;
};

async function makeAdmin(name: string, email: string, role: 'support' | 'super_admin') {
  const id = await ctx.createUser(name, email);
  await ctx.db.insert(platformAdmins).values({ userId: id, role });
  const cookie = await ctx.login(email, 'password123');
  // /admin needs two-step on; the real sign-in flow is tested in admin-sign-in.test.ts.
  await ctx.db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, id));
  await ctx.db.insert(twoFactors).values({ userId: id, secret: 'enc-secret', backupCodes: 'enc-codes' });
  return { id, cookie };
}

beforeAll(async () => {
  await ctx.reset();
  ({ id: superId, cookie: superCookie } = await makeAdmin('Fadhil Z', 'fadhil@ftech.my', 'super_admin'));
  ({ id: supportId, cookie: supportCookie } = await makeAdmin('Nurul A', 'nurul@ftech.my', 'support'));
  expect((await ctx.post('/signup', signupInput({ email: 'owner@example.com', slug: 'owner-biz' }))).status).toBe(201);
});

afterAll(() => ctx.close());

describe('access', () => {
  it('support admins and owners cannot use admin users', async () => {
    const res = await ctx.get('/admin/users', supportCookie);
    expect(res.status).toBe(403);
    expect(await errCode(res)).toBe('super_admin_only');
    const invite = await ctx.send('POST', '/admin/users', supportCookie, { email: 'x@ftech.my', role: 'super_admin', reason: 'Hire' });
    expect(invite.status).toBe(403);
    const owner = await ctx.login('owner@example.com', 'password123');
    expect((await ctx.get('/admin/users', owner)).status).toBe(403);
    expect(await auditOf('add_admin')).toHaveLength(0);
  });

  it('lists active admins with role, two-step and last sign-in', async () => {
    await ctx.db.insert(adminAuditLog).values({ adminUserId: supportId, action: 'sign_in', reason: 'Signed in with a two-step code' });
    const list = await rows();
    expect(list.map((r) => [r.name, r.role, r.status, r.twoFactorEnabled])).toEqual([
      ['Fadhil Z', 'super_admin', 'active', true],
      ['Nurul A', 'support', 'active', true],
    ]);
    expect(list[0]!.lastSignInAt).toBeNull();
    expect(list[1]!.lastSignInAt).not.toBeNull();
  });
});

describe('invite → set password → sign in', () => {
  it('invites by email (link emailed, audit row), then the new admin sets a name and password', async () => {
    ctx.outbox.length = 0;
    expect((await ctx.send('POST', '/admin/users', superCookie, { email: 'new@ftech.my', role: 'support' })).status).toBe(400);
    const res = await ctx.send('POST', '/admin/users', superCookie, { email: ' New@FTech.my ', role: 'support', reason: 'New support staff' });
    expect(res.status).toBe(201);
    const invited = ((await res.json()) as AdminUserRow[]).find((r) => r.email === 'new@ftech.my')!;
    expect(invited).toMatchObject({ status: 'invited', role: 'support', twoFactorEnabled: false, lastSignInAt: null });
    expect(Date.parse(invited.inviteExpiresAt!) - Date.now()).toBeGreaterThan(6.9 * 24 * 3_600_000);

    expect(ctx.outbox.map((m) => [m.to, m.subject])).toEqual([['new@ftech.my', 'You’re invited to the OutletBooking admin panel']]);
    expect(ctx.outbox[0]!.text).toContain('Fadhil Z');
    const token = lastInviteToken();
    expect(ctx.outbox[0]!.text).toContain(`${ctx.env.WEBSITE_URL.replace(/\/$/, '')}/admin/invite/${token}`);
    expect((await auditOf('add_admin')).map((a) => [a.adminUserId, a.reason, a.details])).toEqual([
      [superId, 'New support staff', { email: 'new@ftech.my', role: 'support', invitedAgain: false }],
    ]);

    // No password yet: cannot sign in.
    expect((await ctx.post('/api/auth/sign-in/email', { email: 'new@ftech.my', password: 'password123' })).status).toBe(401);

    const info = await ctx.get(`/admin-invite/${token}`);
    expect(info.status).toBe(200);
    expect((await info.json()) as AdminInviteInfo).toMatchObject({ email: 'new@ftech.my', role: 'support', invitedBy: 'Fadhil Z' });
    expect((await ctx.post(`/admin-invite/${token}/accept`, { name: 'Aiman', password: 'short' })).status).toBe(400);
    const accepted = await ctx.post(`/admin-invite/${token}/accept`, { name: 'Aiman R', password: 'new-admin-pass' });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ email: 'new@ftech.my' });

    // The link works once.
    expect((await ctx.get(`/admin-invite/${token}`)).status).toBe(404);
    expect((await ctx.post(`/admin-invite/${token}/accept`, { name: 'Again', password: 'another-pass' })).status).toBe(404);

    // Signs in with the new password; /admin still needs two-step set up first (I6).
    const signIn = await ctx.post('/api/auth/sign-in/email', { email: 'new@ftech.my', password: 'new-admin-pass' });
    expect(signIn.status).toBe(200);
    const row = (await rows()).find((r) => r.email === 'new@ftech.my')!;
    expect(row).toMatchObject({ name: 'Aiman R', status: 'active', inviteExpiresAt: null });
    const [u] = await ctx.db.select({ v: users.emailVerified }).from(users).where(eq(users.email, 'new@ftech.my'));
    expect(u!.v).toBe(true);
  });

  it('refuses an email that is already an admin or logs in to a business', async () => {
    let res = await ctx.send('POST', '/admin/users', superCookie, { email: 'nurul@ftech.my', role: 'support', reason: 'Again' });
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe('already_admin');
    res = await ctx.send('POST', '/admin/users', superCookie, { email: 'owner@example.com', role: 'support', reason: 'Owner' });
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe('email_in_use');
  });

  it('bad, expired and resent links', async () => {
    expect((await ctx.get('/admin-invite/not-a-token')).status).toBe(400);
    expect((await ctx.get(`/admin-invite/${'a'.repeat(48)}`)).status).toBe(404);

    await ctx.send('POST', '/admin/users', superCookie, { email: 'late@ftech.my', role: 'super_admin', reason: 'Hire' });
    const first = lastInviteToken();
    const [late] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, 'late@ftech.my'));

    const resent = await ctx.send('POST', `/admin/users/${late!.id}/resend-invite`, superCookie, { reason: 'Lost the email' });
    expect(resent.status).toBe(200);
    const second = lastInviteToken();
    expect(second).not.toBe(first);
    expect((await ctx.get(`/admin-invite/${first}`)).status).toBe(404);

    await ctx.db
      .update(verifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verifications.identifier, `admin-invite:${second}`));
    const expired = await ctx.get(`/admin-invite/${second}`);
    expect(expired.status).toBe(410);
    expect(await errCode(expired)).toBe('invite_expired');
    expect((await rows()).find((r) => r.email === 'late@ftech.my')).toMatchObject({ status: 'invited', inviteExpiresAt: null });

    // Cancel = remove an invited admin: the link stops working.
    await ctx.send('POST', `/admin/users/${late!.id}/resend-invite`, superCookie, { reason: 'Try again' });
    const third = lastInviteToken();
    expect((await ctx.send('POST', `/admin/users/${late!.id}/remove`, superCookie, { reason: 'Changed our mind' })).status).toBe(200);
    expect((await ctx.get(`/admin-invite/${third}`)).status).toBe(404);
    expect((await rows()).some((r) => r.email === 'late@ftech.my')).toBe(false);
  });
});

describe('change role, reset two-step, remove', () => {
  it('changes a role (not your own), with an audit row', async () => {
    const path = `/admin/users/${supportId}/role`;
    expect((await ctx.send('POST', path, superCookie, { role: 'super_admin', reason: 'Team lead' })).status).toBe(200);
    expect((await rows()).find((r) => r.userId === supportId)?.role).toBe('super_admin');
    expect(await errCode(await ctx.send('POST', path, superCookie, { role: 'super_admin', reason: 'Again' }))).toBe('no_change');
    expect((await ctx.send('POST', path, superCookie, { role: 'support', reason: 'Back to support' })).status).toBe(200);
    expect((await auditOf('change_admin_role')).map((a) => a.details)).toEqual([
      { email: 'nurul@ftech.my', from: 'support', to: 'super_admin' },
      { email: 'nurul@ftech.my', from: 'super_admin', to: 'support' },
    ]);
    const self = await ctx.send('POST', `/admin/users/${superId}/role`, superCookie, { role: 'support', reason: 'Oops' });
    expect(self.status).toBe(409);
    expect(await errCode(self)).toBe('not_yourself');
    expect((await ctx.send('POST', '/admin/users/999999/role', superCookie, { role: 'support', reason: 'Nobody' })).status).toBe(404);
  });

  it('reset two-step: turned off, two-step secret deleted, signed out everywhere; password kept', async () => {
    expect((await ctx.get('/admin/me', supportCookie)).status).toBe(200);
    const res = await ctx.send('POST', `/admin/users/${supportId}/reset-two-factor`, superCookie, { reason: 'Lost phone' });
    expect(res.status).toBe(200);
    expect((await res.json() as AdminUserRow[]).find((r) => r.userId === supportId)?.twoFactorEnabled).toBe(false);
    expect(await ctx.db.select().from(twoFactors).where(eq(twoFactors.userId, supportId))).toHaveLength(0);
    expect(await ctx.db.select().from(sessions).where(eq(sessions.userId, supportId))).toHaveLength(0);
    expect((await ctx.get('/admin/me', supportCookie)).status).toBe(401);
    expect((await auditOf('reset_two_factor')).map((a) => [a.reason, a.details])).toEqual([['Lost phone', { email: 'nurul@ftech.my' }]]);
    // Next sign-in: password works, then two-step setup is required again.
    supportCookie = await ctx.login('nurul@ftech.my', 'password123');
    const me = await ctx.get('/admin/me', supportCookie);
    expect(me.status).toBe(403);
    expect(await errCode(me)).toBe('two_factor_setup_required');
    expect(await errCode(await ctx.send('POST', `/admin/users/${supportId}/reset-two-factor`, superCookie, { reason: 'Again' }))).toBe('no_change');
  });

  it('removes an admin: no access, signed out, audit entries kept; can be invited again with a fresh start', async () => {
    expect(await errCode(await ctx.send('POST', `/admin/users/${superId}/remove`, superCookie, { reason: 'Remove myself' }))).toBe('not_yourself');
    const res = await ctx.send('POST', `/admin/users/${supportId}/remove`, superCookie, { reason: 'Left FTech' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as AdminUserRow[]).some((r) => r.userId === supportId)).toBe(false);
    const [pa] = await ctx.db.select().from(platformAdmins).where(eq(platformAdmins.userId, supportId));
    expect(pa!.isActive).toBe(false);
    expect(await ctx.db.select().from(sessions).where(eq(sessions.userId, supportId))).toHaveLength(0);
    expect((await ctx.get('/admin/me', supportCookie)).status).toBe(401);
    // Their own audit entries stay.
    expect(await ctx.db.select().from(adminAuditLog).where(and(eq(adminAuditLog.adminUserId, supportId)))).not.toHaveLength(0);
    // Still listed for the I9 filter, marked removed.
    const admins = (await (await ctx.get('/admin/admins', superCookie)).json()) as { userId: number; isActive: boolean }[];
    expect(admins.find((a) => a.userId === supportId)?.isActive).toBe(false);

    // Invited again: the old password no longer works until they set a new one from the link.
    ctx.outbox.length = 0;
    const again = await ctx.send('POST', '/admin/users', superCookie, { email: 'nurul@ftech.my', role: 'support', reason: 'Rejoined' });
    expect(again.status).toBe(201);
    expect((await ctx.post('/api/auth/sign-in/email', { email: 'nurul@ftech.my', password: 'password123' })).status).toBe(401);
    const token = lastInviteToken();
    expect((await ctx.post(`/admin-invite/${token}/accept`, { name: 'Nurul A', password: 'fresh-password' })).status).toBe(200);
    expect((await rows()).find((r) => r.userId === supportId)).toMatchObject({ status: 'active', twoFactorEnabled: false });
    expect((await auditOf('add_admin')).at(-1)?.details).toMatchObject({ email: 'nurul@ftech.my', invitedAgain: true });
  });
});
