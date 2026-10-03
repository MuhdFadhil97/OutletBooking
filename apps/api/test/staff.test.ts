import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { staffInvitations } from '@outletbooking/db';
import type { InvitationInfo, MeResponse, Resource, StaffInvitation, StaffListResponse, StaffMember } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

const ctx = createTestContext();
let ownerA = '';
let ownerB = '';
let court1: Resource;
let court2: Resource;
let courtB: Resource;

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const tokenOf = (inv: StaffInvitation) => inv.inviteUrl.split('/invite/')[1]!;

const invite = (cookie: string, email: string, resourceId: number | null = null) =>
  ctx.send('POST', '/staff/invitations', cookie, { email, resourceId });
const accept = (token: string, body: object = {}, cookie = '') => ctx.send('POST', `/invitations/${token}/accept`, cookie, body);
const newAccount = { name: 'Siti Aminah', phone: '+60111222333', password: 'password123' };

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'staff-a', businessName: 'Arena A' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'staff-b' }))).status).toBe(201);
  ownerA = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');
  court1 = await json<Resource>(await ctx.send('POST', '/resources', ownerA, { name: 'Court 1', resourceType: 'court' }), 201);
  court2 = await json<Resource>(await ctx.send('POST', '/resources', ownerA, { name: 'Court 2', resourceType: 'court' }), 201);
  courtB = await json<Resource>(await ctx.send('POST', '/resources', ownerB, { name: 'B Court', resourceType: 'court' }), 201);
});
afterAll(() => ctx.close());

describe('invite → accept (new account)', () => {
  let inv: StaffInvitation;
  let staffCookie = '';

  it('owner invites by email and gets a shareable link', async () => {
    inv = await json<StaffInvitation>(await invite(ownerA, 'Siti@Example.com', court1.id), 201);
    expect(inv.email).toBe('siti@example.com');
    expect(inv.inviteUrl).toMatch(/\/invite\/[a-f0-9]{48}$/);
    const list = await json<StaffListResponse>(await ctx.get('/staff', ownerA));
    expect(list.invitations.map((i) => i.email)).toEqual(['siti@example.com']);
    expect(list.members.map((m) => m.role)).toEqual(['owner']);
  });

  it('public lookup shows only what the invitee needs', async () => {
    const info = await json<InvitationInfo>(await ctx.get(`/invitations/${tokenOf(inv)}`));
    expect(info).toEqual({
      businessName: 'Arena A',
      email: 'siti@example.com',
      resourceName: 'Court 1',
      status: 'pending',
      accountExists: false,
    });
    expect((await ctx.get('/invitations/not-a-token')).status).toBe(400);
    expect((await ctx.get(`/invitations/${'0'.repeat(48)}`)).status).toBe(404);
  });

  it('accepting creates the login, staff membership and resource link in one go', async () => {
    expect((await accept(tokenOf(inv), {})).status).toBe(400); // needs account details
    expect(await json(await accept(tokenOf(inv), newAccount))).toEqual({ email: 'siti@example.com', businessName: 'Arena A' });

    staffCookie = await ctx.login('siti@example.com', 'password123');
    const me = await json<MeResponse>(await ctx.get('/me', staffCookie));
    expect(me).toMatchObject({ role: 'staff', business: { slug: 'staff-a' } });

    const mine = await json<Resource[]>(await ctx.get('/resources', staffCookie));
    expect(mine.map((r) => r.id)).toEqual([court1.id]);
  });

  it('a used link cannot be reused', async () => {
    const res = await accept(tokenOf(inv), newAccount);
    expect(res.status).toBe(410);
    expect(await errorCode(res)).toBe('invitation_used');
    const info = await json<InvitationInfo>(await ctx.get(`/invitations/${tokenOf(inv)}`));
    expect(info.status).toBe('accepted');
  });

  it('staff cannot manage the team', async () => {
    expect((await ctx.get('/staff', staffCookie)).status).toBe(403);
    expect((await invite(staffCookie, 'x@example.com')).status).toBe(403);
  });

  it('inviting an active member is rejected', async () => {
    const res = await invite(ownerA, 'siti@example.com');
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('already_member');
  });

  it('owner deactivates and reactivates access', async () => {
    const { members } = await json<StaffListResponse>(await ctx.get('/staff', ownerA));
    const siti = members.find((m) => m.email === 'siti@example.com')!;
    expect(siti.resources).toEqual([{ id: court1.id, name: 'Court 1' }]);

    await json<StaffMember>(await ctx.send('PATCH', `/staff/${siti.memberId}`, ownerA, { isActive: false }));
    const blocked = await ctx.get('/me', staffCookie);
    expect(blocked.status).toBe(403); // same session, access gone immediately

    const back = await json<StaffMember>(
      await ctx.send('PATCH', `/staff/${siti.memberId}`, ownerA, { isActive: true, canViewAll: true, resourceIds: [court2.id] }),
    );
    expect(back).toMatchObject({ isActive: true, canViewAll: true, resources: [{ id: court2.id, name: 'Court 2' }] });
    const all = await json<Resource[]>(await ctx.get('/resources', staffCookie));
    expect(all.map((r) => r.id).sort()).toEqual([court1.id, court2.id].sort()); // view all
  });

  it("the owner's own access cannot be removed", async () => {
    const { members } = await json<StaffListResponse>(await ctx.get('/staff', ownerA));
    const owner = members.find((m) => m.role === 'owner')!;
    expect((await ctx.send('PATCH', `/staff/${owner.memberId}`, ownerA, { isActive: false })).status).toBe(403);
  });
});

describe('invite → accept (existing account)', () => {
  it('requires logging in as the invited email', async () => {
    await ctx.createUser('Ravi', 'ravi@example.com');
    const inv = await json<StaffInvitation>(await invite(ownerA, 'ravi@example.com'), 201);
    const info = await json<InvitationInfo>(await ctx.get(`/invitations/${tokenOf(inv)}`));
    expect(info.accountExists).toBe(true);

    const anon = await accept(tokenOf(inv), newAccount);
    expect(anon.status).toBe(401);
    expect(await errorCode(anon)).toBe('login_required');

    // Logged in as someone else → still refused
    expect((await accept(tokenOf(inv), {}, ownerB)).status).toBe(401);

    const ravi = await ctx.login('ravi@example.com', 'password123');
    expect((await accept(tokenOf(inv), {}, ravi)).status).toBe(200);
    expect(await json<MeResponse>(await ctx.get('/me', ravi))).toMatchObject({ role: 'staff', business: { slug: 'staff-a' } });
  });
});

describe('invitation lifecycle', () => {
  it('re-inviting replaces the old link; revoke and expiry work', async () => {
    const first = await json<StaffInvitation>(await invite(ownerA, 'lee@example.com'), 201);
    const second = await json<StaffInvitation>(await invite(ownerA, 'lee@example.com'), 201);
    expect((await ctx.get(`/invitations/${tokenOf(first)}`)).status).toBe(404);

    await ctx.db.update(staffInvitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(staffInvitations.id, second.id));
    const expired = await accept(tokenOf(second), newAccount);
    expect(expired.status).toBe(410);
    expect(await errorCode(expired)).toBe('invitation_expired');
    const list = await json<StaffListResponse>(await ctx.get('/staff', ownerA));
    expect(list.invitations.map((i) => i.email)).not.toContain('lee@example.com'); // expired hidden

    const third = await json<StaffInvitation>(await invite(ownerA, 'lee@example.com'), 201);
    expect((await ctx.send('DELETE', `/staff/invitations/${third.id}`, ownerA)).status).toBe(204);
    expect((await ctx.get(`/invitations/${tokenOf(third)}`)).status).toBe(404);
  });
});

describe('tenant isolation (staff)', () => {
  it("owner B cannot see or change A's team", async () => {
    const listB = await json<StaffListResponse>(await ctx.get('/staff', ownerB));
    expect(listB.members.map((m) => m.email)).toEqual(['b@example.com']);

    const { members, invitations } = await json<StaffListResponse>(await ctx.get('/staff', ownerA));
    const siti = members.find((m) => m.email === 'siti@example.com')!;
    expect((await ctx.send('PATCH', `/staff/${siti.memberId}`, ownerB, { isActive: false })).status).toBe(404);

    const pending = invitations[0] ?? (await json<StaffInvitation>(await invite(ownerA, 'pending@example.com'), 201));
    expect((await ctx.send('DELETE', `/staff/invitations/${pending.id}`, ownerB)).status).toBe(404);
  });

  it("A cannot link B's resources or invite onto them", async () => {
    const { members } = await json<StaffListResponse>(await ctx.get('/staff', ownerA));
    const siti = members.find((m) => m.email === 'siti@example.com')!;
    expect((await ctx.send('PATCH', `/staff/${siti.memberId}`, ownerA, { resourceIds: [courtB.id] })).status).toBe(404);
    expect((await invite(ownerA, 'new@example.com', courtB.id)).status).toBe(404);
  });
});
