import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { adminAuditLog, announcements, businesses, businessMembers, platformAdmins, subscriptions, users } from '@outletbooking/db';
import type { ActiveAnnouncement, AnnouncementAudienceCount, AnnouncementRow } from '@outletbooking/shared';
import { dispatchDueAnnouncements } from '../src/services/admin-announcements';
import { createTestContext, signupInput } from './helpers';

/** I28 · Announcements to owners: audience, channels, schedule, and the in-app banner on Today. Super admins only. */
const ctx = createTestContext();
const MIN = 60_000;
const HOUR = 60 * MIN;

let boss = ''; // super admin
let bossId = 0;
let nurul = ''; // support admin
let ownerA = ''; // Smash Arena PJ: sports, trial
let ownerB = ''; // Bengkel Ali: vehicle_inspection, starter
let staffA = '';
let bizA = 0;
let bizB = 0;
let ownerBId = 0;

const json = async <T>(res: Response, status = 200): Promise<T> => {
  expect(res.status).toBe(status);
  return (await res.json()) as T;
};
const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const base = {
  type: 'maintenance' as const,
  audience: 'all' as const,
  channels: ['email', 'in_app'] as ('email' | 'in_app' | 'push')[],
  title: 'Planned maintenance Sun 25 Oct, 2–4 AM',
  body: 'Booking pages and the app may be unavailable for up to 2 hours.',
};
const send = async (over: Record<string, unknown> = {}, status = 201) =>
  json<AnnouncementRow>(await ctx.send('POST', '/admin/announcements', boss, { ...base, ...over }), status);
const banners = async (cookie: string) => json<ActiveAnnouncement[]>(await ctx.get('/announcements/active', cookie));
const deps = () => ({
  db: ctx.db,
  env: ctx.env,
  mailer: { send: async (m: Parameters<typeof ctx.outbox.push>[0]) => void ctx.outbox.push(m) },
  push: { send: async (m: unknown[]) => m.map(() => ({ status: 'ok' as const, id: 'x' })) },
});
const audits = async () => (await ctx.db.select().from(adminAuditLog).orderBy(adminAuditLog.id)).filter((a) => a.action === 'send_announcement');
/** Emails about the announcement (sign-up also mails a confirmation in the background). */
const mails = () => ctx.outbox.filter((m) => m.subject.includes('maintenance') || m.subject.startsWith('[Test]') || m.subject.includes('Walk-in'));

async function makeAdmin(name: string, email: string, role: 'support' | 'super_admin') {
  const id = await ctx.createUser(name, email);
  await ctx.db.insert(platformAdmins).values({ userId: id, role, isActive: true });
  const cookie = await ctx.login(email, 'password123');
  await ctx.db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, id));
  return { id, cookie };
}

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'ann-a', businessName: 'Smash Arena PJ', template: 'sports' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'ann-b', businessName: 'Bengkel Ali', template: 'vehicle_inspection' }))).status).toBe(201);
  ownerA = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');
  bizA = (await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'ann-a')))[0]!.id;
  bizB = (await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'ann-b')))[0]!.id;
  ownerBId = (await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, 'b@example.com')))[0]!.id;
  await ctx.db.update(subscriptions).set({ plan: 'starter', status: 'active' }).where(eq(subscriptions.businessId, bizB));
  const staffId = await ctx.createUser('Staff Siti', 'siti@example.com');
  await ctx.db.insert(businessMembers).values({ businessId: bizA, userId: staffId, role: 'staff' });
  staffA = await ctx.login('siti@example.com', 'password123');
  ({ id: bossId, cookie: boss } = await makeAdmin('Fadhil Z', 'fadhil@ftech.my', 'super_admin'));
  ({ cookie: nurul } = await makeAdmin('Nurul A', 'nurul@ftech.my', 'support'));
});

beforeEach(async () => {
  await ctx.db.execute(sql`TRUNCATE announcements RESTART IDENTITY CASCADE`);
  await ctx.db.delete(adminAuditLog);
  ctx.outbox.length = 0;
  ctx.pushes.length = 0;
});

afterAll(() => ctx.close());

describe('access', () => {
  it('super admins only: Support admins, owners and signed-out callers are refused', async () => {
    for (const path of ['/admin/announcements', '/admin/announcements/audience?audience=all']) {
      expect((await ctx.get(path)).status).toBe(401);
      expect((await ctx.get(path, ownerA)).status).toBe(403);
      expect((await ctx.get(path, nurul)).status).toBe(403);
      expect((await ctx.get(path, boss)).status).toBe(200);
    }
    expect((await ctx.send('POST', '/admin/announcements', nurul, base)).status).toBe(403);
    expect((await ctx.send('POST', '/admin/announcements/test', nurul, base)).status).toBe(403);
    expect((await ctx.send('POST', '/admin/announcements/1/cancel', nurul)).status).toBe(403);
  });
});

describe('sending now', () => {
  it('emails every owner once (not staff), counts them, and audits without the message text', async () => {
    await ctx.db.insert(businessMembers).values({ businessId: bizB, userId: (await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, 'siti@example.com')))[0]!.id, role: 'staff' });
    const a = await send();
    expect(a).toMatchObject({ status: 'sent', sentCount: 2, audience: 'all', createdBy: 'Fadhil Z' });
    expect(a.sentAt).not.toBeNull();
    const sent = mails();
    expect(sent.map((m) => m.to).sort()).toEqual(['a@example.com', 'b@example.com']);
    expect(sent[0]!.subject).toBe(base.title);
    expect(sent[0]!.text).toContain('Booking pages and the app may be unavailable');
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.adminUserId).toBe(bossId);
    expect(rows[0]!.reason).toContain('maintenance');
    expect(JSON.stringify(rows[0])).not.toContain('unavailable for up to 2 hours');
  });

  it('pushes only when the push channel is on', async () => {
    await ctx.send('PUT', '/me/push-token', ownerA, { token: 'ExponentPushToken[ownerA]', platform: 'android' });
    await send({ channels: ['in_app'] });
    expect(ctx.pushes).toHaveLength(0);
    await send({ channels: ['push'] });
    expect(ctx.pushes.map((p) => p.to)).toEqual(['ExponentPushToken[ownerA]']);
    expect(mails()).toHaveLength(0); // no email channel
  });

  it('targets one plan, one business type, or one business', async () => {
    expect((await send({ audience: 'plan', audienceValue: 'starter', channels: ['email'] })).sentCount).toBe(1);
    expect(mails().map((m) => m.to)).toEqual(['b@example.com']);
    ctx.outbox.length = 0;
    expect((await send({ audience: 'template', audienceValue: 'sports', channels: ['email'] })).sentCount).toBe(1);
    expect(mails().map((m) => m.to)).toEqual(['a@example.com']);
    ctx.outbox.length = 0;
    expect((await send({ audience: 'business', audienceValue: 'ann-b', channels: ['email'] })).sentCount).toBe(1);
    expect(mails().map((m) => m.to)).toEqual(['b@example.com']);
    const count = async (qs: string) => (await json<AnnouncementAudienceCount>(await ctx.get(`/admin/announcements/audience?${qs}`, boss))).owners;
    expect(await count('audience=plan&value=trial')).toBe(1);
    expect(await count('audience=all')).toBe(2);
  });

  it('leaves out closed businesses, and refuses an audience nobody is in', async () => {
    await ctx.db.update(businesses).set({ closeRequestedAt: new Date() }).where(eq(businesses.id, bizB));
    expect((await send({ channels: ['email'] })).sentCount).toBe(1);
    await ctx.db.update(businesses).set({ closeRequestedAt: null }).where(eq(businesses.id, bizB));
    const none = await ctx.send('POST', '/admin/announcements', boss, { ...base, audience: 'business', audienceValue: 'no-such-link' });
    expect(none.status).toBe(409);
    expect(await errCode(none)).toBe('no_owners');
    expect(await ctx.db.select().from(announcements)).toHaveLength(1); // nothing saved for the refused one
  });

  it('an owner of two businesses gets one email', async () => {
    const [second] = await ctx.db.insert(businesses).values({ name: 'Second Courts', slug: 'ann-b2', template: 'sports', resourceLabel: 'Court' }).returning({ id: businesses.id });
    await ctx.db.insert(businessMembers).values({ businessId: second!.id, userId: ownerBId, role: 'owner' });
    expect((await send({ channels: ['email'] })).sentCount).toBe(2);
    expect(mails().filter((m) => m.to === 'b@example.com')).toHaveLength(1);
    await ctx.db.delete(businesses).where(eq(businesses.id, second!.id));
  });

  it('keeps going when one email fails', async () => {
    const failing = { ...deps(), mailer: { send: async () => Promise.reject(new Error('Resend is down')) } };
    const { createAnnouncement } = await import('../src/services/admin-announcements');
    const a = await createAnnouncement(failing, bossId, { ...base, channels: ['email'] });
    expect(a.status).toBe('sent');
    expect(a.sentCount).toBe(2);
  });
});

describe('validation', () => {
  it('needs a way to send it, a value for a partial audience, and sensible dates', async () => {
    const bad = async (over: Record<string, unknown>) => ctx.send('POST', '/admin/announcements', boss, { ...base, ...over });
    expect((await bad({ channels: [] })).status).toBe(400);
    expect((await bad({ audience: 'plan' })).status).toBe(400); // plan without a value
    expect((await bad({ audience: 'plan', audienceValue: 'gold' })).status).toBe(400);
    expect((await bad({ audience: 'template', audienceValue: 'bakery' })).status).toBe(400);
    expect((await bad({ audience: 'all', audienceValue: 'starter' })).status).toBe(400);
    expect((await bad({ title: 'x' })).status).toBe(400);
    expect((await bad({ channels: ['email'], endsAt: new Date(Date.now() + HOUR).toISOString() })).status).toBe(400); // end date needs the banner
    expect((await bad({ endsAt: new Date(Date.now() - HOUR).toISOString() })).status).toBe(400);
    expect((await bad({ sendAt: new Date(Date.now() + 2 * HOUR).toISOString(), endsAt: new Date(Date.now() + HOUR).toISOString() })).status).toBe(400);
    expect(await ctx.db.select().from(announcements)).toHaveLength(0);
  });
});

describe('scheduling', () => {
  it('waits until its time, then the job sends it once', async () => {
    const at = new Date(Date.now() + 2 * HOUR);
    const a = await send({ sendAt: at.toISOString(), channels: ['email'] });
    expect(a).toMatchObject({ status: 'scheduled', sentAt: null, sentCount: 0 });
    expect(mails()).toHaveLength(0);
    expect((await audits())[0]!.reason).toContain('scheduled for');

    expect(await dispatchDueAnnouncements(deps(), new Date(Date.now() + HOUR))).toBe(0); // not yet
    expect(await dispatchDueAnnouncements(deps(), new Date(at.getTime() + MIN))).toBe(1);
    expect(await dispatchDueAnnouncements(deps(), new Date(at.getTime() + 2 * MIN))).toBe(0); // never twice
    expect(mails()).toHaveLength(2);
    const [row] = await ctx.db.select().from(announcements);
    expect(row!.sentCount).toBe(2);
    expect((await audits()).map((r) => r.reason)).toEqual([expect.stringContaining('scheduled for'), 'Announcement #1 sent to 2 owners']);
  });

  it('a scheduled one can be cancelled; a sent one cannot', async () => {
    const scheduled = await send({ sendAt: new Date(Date.now() + HOUR).toISOString() });
    expect((await ctx.send('POST', `/admin/announcements/${scheduled.id}/cancel`, boss)).status).toBe(204);
    expect(await ctx.db.select().from(announcements)).toHaveLength(0);
    expect((await audits()).at(-1)!.reason).toBe(`Announcement #${scheduled.id} cancelled before it was sent`);

    const sent = await send();
    const res = await ctx.send('POST', `/admin/announcements/${sent.id}/cancel`, boss);
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe('already_sent');
    expect((await ctx.send('POST', '/admin/announcements/9999/cancel', boss)).status).toBe(404);
  });

  it('the history lists newest first with status', async () => {
    const first = await send({ title: 'Walk-in in two taps', type: 'feature_change', channels: ['in_app'], endsAt: new Date(Date.now() + HOUR).toISOString() });
    const later = await send({ sendAt: new Date(Date.now() + 5 * HOUR).toISOString() });
    await ctx.db.update(announcements).set({ endsAt: new Date(Date.now() - MIN) }).where(eq(announcements.id, first.id));
    const rows = await json<AnnouncementRow[]>(await ctx.get('/admin/announcements', boss));
    expect(rows.map((r) => [r.id, r.status])).toEqual([[later.id, 'scheduled'], [first.id, 'ended']]);
  });
});

describe('send test to me', () => {
  it('emails the admin only, with [Test], and saves nothing', async () => {
    const res = await json<{ sentTo: string }>(await ctx.send('POST', '/admin/announcements/test', boss, { ...base, channels: ['email'] }));
    expect(res.sentTo).toBe('fadhil@ftech.my');
    expect(mails().map((m) => [m.to, m.subject])).toEqual([['fadhil@ftech.my', `[Test] ${base.title}`]]);
    expect(await ctx.db.select().from(announcements)).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
  });
});

describe('the banner on Today', () => {
  it('shows to owners of matching businesses until dismissed; email-only never shows', async () => {
    const a = await send({ audience: 'template', audienceValue: 'sports' });
    await send({ title: 'Email only notice', channels: ['email'] });
    expect(await banners(ownerA)).toEqual([{ id: a.id, type: 'maintenance', title: base.title, body: base.body }]);
    expect(await banners(ownerB)).toEqual([]); // not their business type

    expect((await ctx.send('POST', `/announcements/${a.id}/dismiss`, ownerA)).status).toBe(204);
    expect((await ctx.send('POST', `/announcements/${a.id}/dismiss`, ownerA)).status).toBe(204); // again is fine
    expect(await banners(ownerA)).toEqual([]);
  });

  it('is hidden after its end date, and not shown before it is sent', async () => {
    const live = await send({ endsAt: new Date(Date.now() + HOUR).toISOString() });
    await send({ sendAt: new Date(Date.now() + HOUR).toISOString() }); // scheduled: not out yet
    expect((await banners(ownerA)).map((b) => b.id)).toEqual([live.id]);
    await ctx.db.update(announcements).set({ endsAt: new Date(Date.now() - MIN) }).where(eq(announcements.id, live.id));
    expect(await banners(ownerA)).toEqual([]);
  });

  it('is for owners only, and one owner cannot dismiss another business’s notice', async () => {
    const forB = await send({ audience: 'business', audienceValue: 'ann-b' });
    expect((await ctx.get('/announcements/active', staffA)).status).toBe(403);
    expect((await ctx.get('/announcements/active')).status).toBe(401);
    expect((await ctx.send('POST', `/announcements/${forB.id}/dismiss`, ownerA)).status).toBe(404);
    expect(await banners(ownerB)).toHaveLength(1);
    expect((await ctx.send('POST', `/announcements/${forB.id}/dismiss`, ownerB)).status).toBe(204);
  });

  it('a business created after it was sent does not see it', async () => {
    const a = await send();
    expect(await banners(ownerA)).toHaveLength(1);
    await ctx.db.update(businesses).set({ createdAt: new Date(Date.now() + HOUR) }).where(eq(businesses.id, bizA));
    expect(await banners(ownerA)).toEqual([]);
    await ctx.db.update(businesses).set({ createdAt: new Date(Date.now() - 24 * HOUR) }).where(eq(businesses.id, bizA));
    expect((await banners(ownerA)).map((b) => b.id)).toEqual([a.id]);
  });
});
