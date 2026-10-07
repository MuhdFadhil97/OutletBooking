import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { businesses, businessMembers } from '@outletbooking/db';
import type { MeResponse, Resource, StaffInvitation, StaffListResponse, StaffMember } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

/** D12 permissions, enforced in the API: can_edit_setup, can_take_payments (+ can_view_all in bookings tests). */
const ctx = createTestContext();
let ownerA = '';
let ownerB = '';
let staffA = '';
let bizA = 0;
let staffMemberId = 0;
let ownerMemberId = 0;
let court: Resource;

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const me = async (cookie: string) => json<MeResponse>(await ctx.get('/me', cookie));
const setAccess = (cookie: string, memberId: number, body: object) => ctx.send('PATCH', `/staff/${memberId}`, cookie, body);

/** One write per setup area; returns the status codes. */
async function setupWrites(cookie: string) {
  const hours = { hours: [{ weekday: 1, startTime: '09:00', endTime: '18:00' }] };
  return {
    service: (await ctx.send('POST', '/services', cookie, { name: `Svc ${Math.random()}`, durationMin: 60 })).status,
    hours: (await ctx.send('PUT', `/resources/${court.id}/working-hours`, cookie, hours)).status,
    timeOff: (
      await ctx.send('POST', '/time-off', cookie, {
        resourceId: court.id,
        startAt: '2026-12-01T09:00:00+08:00',
        endAt: '2026-12-01T12:00:00+08:00',
      })
    ).status,
    field: (
      await ctx.send('POST', '/booking-fields', cookie, {
        fieldKey: `q_${Math.floor(Math.random() * 1e6)}`,
        label: 'Question',
        fieldType: 'text',
      })
    ).status,
  };
}

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'perm-a' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'perm-b' }))).status).toBe(201);
  ownerA = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');
  const [a] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'perm-a'));
  bizA = a!.id;

  const staffUserId = await ctx.createUser('Staff Siti', 'siti@example.com');
  const [m] = await ctx.db
    .insert(businessMembers)
    .values({ businessId: bizA, userId: staffUserId, role: 'staff' })
    .returning({ id: businessMembers.id });
  staffMemberId = m!.id;
  const [o] = await ctx.db
    .select({ id: businessMembers.id })
    .from(businessMembers)
    .where(and(eq(businessMembers.businessId, bizA), eq(businessMembers.role, 'owner')));
  ownerMemberId = o!.id;
  staffA = await ctx.login('siti@example.com', 'password123');
  court = await json<Resource>(await ctx.send('POST', '/resources', ownerA, { name: 'Court 1', resourceType: 'court' }), 201);
});
afterAll(() => ctx.close());

describe('defaults', () => {
  it('/me: owner has every permission; new staff can take payments but not change setup', async () => {
    expect((await me(ownerA)).permissions).toEqual({ canViewAll: true, canTakePayments: true, canEditSetup: true });
    expect((await me(staffA)).permissions).toEqual({ canViewAll: false, canTakePayments: true, canEditSetup: false });
  });

  it('staff without "can change setup" cannot write services, hours, time off or questions', async () => {
    expect(await setupWrites(staffA)).toEqual({ service: 403, hours: 403, timeOff: 403, field: 403 });
    expect((await ctx.get('/time-off', staffA)).status).toBe(403);
  });

  it('owner can', async () => {
    expect(await setupWrites(ownerA)).toEqual({ service: 201, hours: 200, timeOff: 201, field: 201 });
  });
});

describe('"can change setup"', () => {
  it('the owner grants it on D12; staff can then edit services, prices and hours', async () => {
    const updated = await json<StaffMember>(await setAccess(ownerA, staffMemberId, { canEditSetup: true }));
    expect(updated).toMatchObject({ canEditSetup: true, canTakePayments: true, canViewAll: false });
    expect((await me(staffA)).permissions.canEditSetup).toBe(true);
    expect(await setupWrites(staffA)).toEqual({ service: 201, hours: 200, timeOff: 201, field: 201 });
  });

  it('still owner-only: resources, business profile, staff management', async () => {
    expect((await ctx.send('POST', '/resources', staffA, { name: 'Court 9', resourceType: 'court' })).status).toBe(403);
    expect((await ctx.send('PATCH', '/businesses/current', staffA, { name: 'Renamed' })).status).toBe(403);
    expect((await ctx.get('/staff', staffA)).status).toBe(403);
    expect((await setAccess(staffA, staffMemberId, { canViewAll: true })).status).toBe(403);
  });

  it('revoking takes effect on the next request (read from business_members, not the session)', async () => {
    await json(await setAccess(ownerA, staffMemberId, { canEditSetup: false, canTakePayments: false }));
    expect((await me(staffA)).permissions).toEqual({ canViewAll: false, canTakePayments: false, canEditSetup: false });
    expect((await setupWrites(staffA)).service).toBe(403);
  });

  it("the owner's own access cannot be removed", async () => {
    for (const flag of ['canTakePayments', 'canEditSetup', 'canViewAll']) {
      expect((await setAccess(ownerA, ownerMemberId, { [flag]: false })).status).toBe(403);
    }
  });

  it("another business's owner cannot change this staff member", async () => {
    expect((await setAccess(ownerB, staffMemberId, { canEditSetup: true })).status).toBe(404);
  });
});

describe('invitations carry permissions', () => {
  it('defaults, then the chosen flags end up on the membership', async () => {
    const plain = await json<StaffInvitation>(await ctx.send('POST', '/staff/invitations', ownerA, { email: 'plain@example.com' }), 201);
    expect(plain).toMatchObject({ canViewAll: false, canTakePayments: true, canEditSetup: false });

    const inv = await json<StaffInvitation>(
      await ctx.send('POST', '/staff/invitations', ownerA, {
        email: 'lead@example.com',
        resourceId: court.id,
        canViewAll: true,
        canTakePayments: false,
        canEditSetup: true,
      }),
      201,
    );
    const list = await json<StaffListResponse>(await ctx.get('/staff', ownerA));
    expect(list.invitations.find((i) => i.email === 'lead@example.com')).toMatchObject({
      canViewAll: true,
      canTakePayments: false,
      canEditSetup: true,
    });

    const token = inv.inviteUrl.split('/invite/')[1]!;
    const body = { name: 'Lead Hafiz', phone: '+60111222444', password: 'password123' };
    expect((await ctx.send('POST', `/invitations/${token}/accept`, '', body)).status).toBe(200);
    const lead = await ctx.login('lead@example.com', 'password123');
    expect((await me(lead)).permissions).toEqual({ canViewAll: true, canTakePayments: false, canEditSetup: true });
    const member = (await json<StaffListResponse>(await ctx.get('/staff', ownerA))).members.find((x) => x.email === 'lead@example.com');
    expect(member).toMatchObject({ canViewAll: true, canTakePayments: false, canEditSetup: true, resources: [{ id: court.id }] });
  });

  it('validates the flags', async () => {
    expect((await ctx.send('POST', '/staff/invitations', ownerA, { email: 'x@example.com', canEditSetup: 'yes' })).status).toBe(400);
  });
});
