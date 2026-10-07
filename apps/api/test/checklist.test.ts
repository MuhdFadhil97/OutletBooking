import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { businesses, businessMembers } from '@outletbooking/db';
import type { Resource, Service, SetupChecklist } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

const ctx = createTestContext();
let owner: string;
let staff: string;

const json = async <T>(res: Response, status = 200): Promise<T> => {
  expect(res.status).toBe(status);
  return (await res.json()) as T;
};
const checklist = async (cookie = owner) => json<SetupChecklist>(await ctx.get('/businesses/current/checklist', cookie));
const doneKeys = (c: SetupChecklist) => c.steps.filter((s) => s.done).map((s) => s.key);

beforeEach(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput())).status).toBe(201);
  owner = await ctx.login('ali@example.com', 'password123');

  const [biz] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'ali-courts'));
  const staffId = await ctx.createUser('Staff Siti', 'siti@example.com');
  await ctx.db.insert(businessMembers).values({ businessId: biz!.id, userId: staffId, role: 'staff' });
  staff = await ctx.login('siti@example.com', 'password123');
});
afterAll(() => ctx.close());

describe('D8 · setup checklist', () => {
  it('a brand-new business has only "account" done, in wireframe order', async () => {
    const c = await checklist();
    expect(c.steps.map((s) => s.key)).toEqual(['account', 'resources', 'payments', 'shareLink', 'testBooking']);
    expect(doneKeys(c)).toEqual(['account']);
    expect(c).toMatchObject({ doneCount: 1, total: 5, resourceCount: 0, hidden: false });
  });

  it('"resources" needs an active resource WITH working hours', async () => {
    const court = await json<Resource>(await ctx.send('POST', '/resources', owner, { name: 'Court 1', resourceType: 'court' }), 201);
    expect(doneKeys(await checklist())).not.toContain('resources');

    await json(await ctx.send('PUT', `/resources/${court.id}/working-hours`, owner, { hours: [{ weekday: 1, startTime: '08:00', endTime: '22:00' }] }));
    const c = await checklist();
    expect(doneKeys(c)).toContain('resources');
    expect(c.resourceCount).toBe(1);
  });

  it('"share link" and "hide" are recorded by the app; the first time is kept', async () => {
    const shared = await json<SetupChecklist>(await ctx.send('POST', '/businesses/current/checklist', owner, { linkShared: true }));
    expect(doneKeys(shared)).toContain('shareLink');
    expect(shared.hidden).toBe(false);

    const [before] = await ctx.db.select({ settings: businesses.settings }).from(businesses);
    await ctx.send('POST', '/businesses/current/checklist', owner, { linkShared: true });
    const [after] = await ctx.db.select({ settings: businesses.settings }).from(businesses);
    expect(after!.settings.checklistLinkSharedAt).toBe(before!.settings.checklistLinkSharedAt);

    const hidden = await json<SetupChecklist>(await ctx.send('POST', '/businesses/current/checklist', owner, { hide: true }));
    expect(hidden.hidden).toBe(true);
  });

  it('"test booking" ticks once the business has a booking', async () => {
    const court = await json<Resource>(await ctx.send('POST', '/resources', owner, { name: 'Court 1', resourceType: 'court' }), 201);
    const allWeek = { hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '00:00', endTime: '23:59' })) };
    await json(await ctx.send('PUT', `/resources/${court.id}/working-hours`, owner, allWeek));
    const service = await json<Service>(
      await ctx.send('POST', '/services', owner, { name: 'Court hire', durationMin: 60, priceSen: 2000, resourceIds: [court.id] }),
      201,
    );
    const start = new Date(Date.now() + 3 * 86_400_000);
    start.setUTCHours(4, 0, 0, 0); // 12:00 in Kuala Lumpur
    await json(
      await ctx.send('POST', '/bookings', owner, {
        serviceId: service.id,
        resourceId: court.id,
        startAt: start.toISOString(),
        customer: { name: 'Test', phone: '+60123456789' },
      }),
      201,
    );
    expect(doneKeys(await checklist())).toContain('testBooking');
  });

  it('is owner-only and validates input', async () => {
    expect((await ctx.get('/businesses/current/checklist', staff)).status).toBe(403);
    expect((await ctx.send('POST', '/businesses/current/checklist', staff, { hide: true })).status).toBe(403);
    expect((await ctx.send('POST', '/businesses/current/checklist', owner, {})).status).toBe(400);
    expect((await ctx.send('POST', '/businesses/current/checklist', owner, { hide: false })).status).toBe(400);
    expect((await ctx.get('/businesses/current/checklist')).status).toBe(401);
  });

  it("only reads the caller's own business", async () => {
    expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'b-courts' }))).status).toBe(201);
    const ownerB = await ctx.login('b@example.com', 'password123');
    await ctx.send('POST', '/businesses/current/checklist', ownerB, { linkShared: true, hide: true });

    const mine = await checklist();
    expect(doneKeys(mine)).not.toContain('shareLink');
    expect(mine.hidden).toBe(false);
  });
});
