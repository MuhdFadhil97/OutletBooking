import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { count, eq, inArray } from 'drizzle-orm';
import {
  bookingEvents,
  bookings,
  businesses,
  businessMembers,
  customers,
  refunds,
  services,
  sessions,
  users,
} from '@outletbooking/db';
import type { Booking, Resource, Service } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

/** H6 · Delete my account and business data. */
const ctx = createTestContext();
let owner = '';
let ownerB = '';
let bizA = 0;
let staffOnlyHere = 0;
let staffElsewhereToo = 0;

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const del = (cookie: string, body: object) => ctx.send('DELETE', '/me', cookie, body);
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const bizId = async (slug: string) =>
  (await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, slug)))[0]?.id;

beforeEach(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'del-a', businessName: 'Smash Arena PJ' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'del-b', businessName: 'Other Biz' }))).status).toBe(201);
  owner = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');
  bizA = (await bizId('del-a'))!;
  const bizB = (await bizId('del-b'))!;

  staffOnlyHere = await ctx.createUser('Siti', 'siti@example.com');
  staffElsewhereToo = await ctx.createUser('Ravi', 'ravi@example.com');
  await ctx.db.insert(businessMembers).values([
    { businessId: bizA, userId: staffOnlyHere, role: 'staff' },
    { businessId: bizA, userId: staffElsewhereToo, role: 'staff' },
    { businessId: bizB, userId: staffElsewhereToo, role: 'staff' },
  ]);

  // Some data in business A: a booking (+ event), its customer, a recorded refund.
  const court = await json<Resource>(await ctx.send('POST', '/resources', owner, { name: 'Court 1', resourceType: 'court' }), 201);
  await json(
    await ctx.send('PUT', `/resources/${court.id}/working-hours`, owner, {
      hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '08:00', endTime: '22:00' })),
    }),
  );
  const svc = await json<Service>(await ctx.send('POST', '/services', owner, { name: 'Court hire', durationMin: 60, resourceIds: [court.id] }), 201);
  const b = await json<Booking>(
    await ctx.send('POST', '/bookings', owner, {
      serviceId: svc.id,
      resourceId: court.id,
      startAt: '2026-11-02T10:00:00+08:00',
      customer: { name: 'Ali', phone: '+60123456789' },
    }),
    201,
  );
  await ctx.db.insert(refunds).values({ businessId: bizA, bookingId: b.id, amountSen: 1000, method: 'cash' });
});
afterAll(() => ctx.close());

describe('DELETE /me', () => {
  it('erases the business, its data and the owner login; staff who only worked here lose their login', async () => {
    expect((await del(owner, { password: 'password123', confirmBusinessName: '  smash arena   pj ' })).status).toBe(204);

    expect(await bizId('del-a')).toBeUndefined();
    for (const table of [bookings, bookingEvents, refunds, customers, services]) {
      const [row] = await ctx.db.select({ n: count() }).from(table).where(eq(table.businessId, bizA));
      expect(row!.n).toBe(0);
    }
    const left = await ctx.db.select({ email: users.email }).from(users).where(inArray(users.email, ['a@example.com', 'siti@example.com', 'ravi@example.com']));
    // Ravi still works for business B, so his login stays.
    expect(left.map((u) => u.email)).toEqual(['ravi@example.com']);

    // The owner's sessions are gone: the old cookie no longer works, and the login is gone.
    expect((await ctx.get('/me', owner)).status).toBe(401);
    expect((await ctx.post('/api/auth/sign-in/email', { email: 'a@example.com', password: 'password123' })).status).toBe(401);
    const [s] = await ctx.db.select({ n: count() }).from(sessions);
    expect(s!.n).toBeGreaterThan(0); // business B's owner is still logged in
  });

  it('leaves other businesses untouched', async () => {
    await del(owner, { password: 'password123', confirmBusinessName: 'Smash Arena PJ' });
    expect((await ctx.get('/me', ownerB)).status).toBe(200);
    expect(await bizId('del-b')).toBeDefined();
  });

  it('needs the right password and business name; nothing is deleted otherwise', async () => {
    const wrongPw = await del(owner, { password: 'nope', confirmBusinessName: 'Smash Arena PJ' });
    expect(wrongPw.status).toBe(400);
    expect(await errorCode(wrongPw)).toBe('invalid_password');

    const wrongName = await del(owner, { password: 'password123', confirmBusinessName: 'Other Biz' });
    expect(wrongName.status).toBe(400);
    expect(await errorCode(wrongName)).toBe('confirmation_mismatch');

    expect((await del(owner, {})).status).toBe(400);
    expect(await bizId('del-a')).toBe(bizA);
    expect((await ctx.get('/me', owner)).status).toBe(200);
  });

  it('staff cannot delete the business; logged-out callers get 401', async () => {
    const siti = await ctx.login('siti@example.com', 'password123');
    expect((await del(siti, { password: 'password123', confirmBusinessName: 'Smash Arena PJ' })).status).toBe(403);
    expect((await ctx.send('DELETE', '/me', '', { password: 'x', confirmBusinessName: 'x' })).status).toBe(401);
    expect(await bizId('del-a')).toBe(bizA);
  });

  it("an owner can only delete their own business (B's owner typing A's name fails)", async () => {
    const res = await del(ownerB, { password: 'password123', confirmBusinessName: 'Smash Arena PJ' });
    expect(res.status).toBe(400);
    expect(await bizId('del-a')).toBe(bizA);
  });
});
