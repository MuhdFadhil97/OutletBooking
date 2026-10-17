import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { adminAuditLog, businesses, platformAdmins, privacyRequests, users } from '@outletbooking/db';
import { privacyDaysLeft, type PrivacyRequestDetail, type PrivacyRequestRow, type PrivacySummary } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

/** I25 · Privacy (PDPA) requests: logged, ticked off, answered within 21 days. Open to every admin. */
const ctx = createTestContext();
const DAY = 86_400_000;

let nurul = ''; // support admin
let nurulId = 0;
let owner = '';
let bizId = 0;

const json = async <T>(res: Response, status = 200): Promise<T> => {
  expect(res.status).toBe(status);
  return (await res.json()) as T;
};
const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const create = (body: Record<string, unknown> = {}) =>
  ctx.send('POST', '/admin/privacy', nurul, {
    requesterName: 'Aina Rahman',
    requesterKind: 'owner',
    kind: 'access',
    requesterEmail: 'aina@example.com',
    ...body,
  });
const make = async (body: Record<string, unknown> = {}) => json<PrivacyRequestDetail>(await create(body), 201);
const list = async (qs = '') => json<PrivacyRequestRow[]>(await ctx.get(`/admin/privacy${qs}`, nurul));
const status = (id: number, st: string, extra: Record<string, unknown> = {}) =>
  ctx.send('POST', `/admin/privacy/${id}/status`, nurul, { status: st, ...extra });
const tick = (id: number, step: string, done = true) => ctx.send('POST', `/admin/privacy/${id}/checklist`, nurul, { step, done });
const privacyAudit = async () => (await ctx.db.select().from(adminAuditLog).orderBy(adminAuditLog.id)).filter((a) => a.action === 'privacy_request_update');

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'owner@example.com', slug: 'priv-biz', businessName: 'Laman Realty' }))).status).toBe(201);
  owner = await ctx.login('owner@example.com', 'password123');
  bizId = (await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'priv-biz')))[0]!.id;
  nurulId = await ctx.createUser('Nurul A', 'nurul@ftech.my');
  await ctx.db.insert(platformAdmins).values({ userId: nurulId, role: 'support', isActive: true });
  nurul = await ctx.login('nurul@ftech.my', 'password123');
  await ctx.db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, nurulId));
});

beforeEach(async () => {
  await ctx.db.execute(sql`TRUNCATE privacy_requests RESTART IDENTITY CASCADE`);
  await ctx.db.delete(adminAuditLog);
});

afterAll(() => ctx.close());

describe('access', () => {
  it('needs an admin session; owners are refused; a Support admin can use all of it', async () => {
    for (const path of ['/admin/privacy/summary', '/admin/privacy']) {
      expect((await ctx.get(path)).status).toBe(401);
      expect((await ctx.get(path, owner)).status).toBe(403);
      expect((await ctx.get(path, nurul)).status).toBe(200);
    }
    expect((await ctx.send('POST', '/admin/privacy', owner, {})).status).toBe(403);
  });
});

describe('logging a request', () => {
  it('is due 21 days after it was received, with "logged" ticked and the admin as handler', async () => {
    const r = await make();
    expect(r).toMatchObject({
      requesterName: 'Aina Rahman',
      requesterKind: 'owner',
      kind: 'access',
      status: 'open',
      business: null,
      handledBy: { id: nurulId, name: 'Nurul A' },
      checklist: { logged: true, id_checked: false, change_made: false, replied: false },
      extendedReason: null,
      closedAt: null,
    });
    expect(Date.parse(r.dueAt) - Date.parse(r.receivedAt)).toBe(21 * DAY);
  });

  it('counts the 21 days from the day it arrived, not the day it was logged; not from the future', async () => {
    const received = new Date(Date.now() - 10 * DAY);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(received);
    const r = await make({ receivedOn: day });
    expect(r.receivedAt).toBe(new Date(`${day}T00:00:00+08:00`).toISOString());
    expect(privacyDaysLeft(r.dueAt)).toBeGreaterThanOrEqual(10);
    expect(privacyDaysLeft(r.dueAt)).toBeLessThanOrEqual(12);

    const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(Date.now() + 2 * DAY));
    const res = await create({ receivedOn: tomorrow });
    expect(res.status).toBe(400);
    expect(await errCode(res)).toBe('received_in_future');
  });

  it('needs an email or a mobile number, and a business for a customer’s request', async () => {
    expect((await create({ requesterEmail: undefined })).status).toBe(400);
    expect((await make({ requesterEmail: undefined, requesterPhone: '+60123456789' })).requesterPhone).toBe('+60123456789');
    const res = await create({ requesterKind: 'customer' });
    expect(res.status).toBe(400);
    expect(await errCode(res)).toBe('business_required');
    const ok = await make({ requesterKind: 'customer', businessId: bizId, kind: 'deletion' });
    expect(ok.business).toEqual({ id: bizId, name: 'Laman Realty' });
    expect((await create({ businessId: 99_999 })).status).toBe(404);
  });

  it('audits what happened without who asked', async () => {
    const r = await make({ requesterName: 'Secret Person', notes: 'private details' });
    const rows = await privacyAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.adminUserId).toBe(nurulId);
    expect(rows[0]!.reason).toBe(`Request #${r.id} logged · access`);
    expect(JSON.stringify(rows[0])).not.toMatch(/Secret Person|aina@example|private details/);
  });
});

describe('the list', () => {
  it('open and due-soon show the nearest deadline first; done shows finished ones; all shows everything', async () => {
    const late = await make({ requesterName: 'Late One', receivedOn: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(Date.now() - 20 * DAY)) });
    const fresh = await make({ requesterName: 'Fresh One' });
    const done = await make({ requesterName: 'Done One', kind: 'stop_marketing' });
    expect((await tick(done.id, 'replied')).status).toBe(200);
    expect((await status(done.id, 'done')).status).toBe(200);

    expect((await list('?tab=open')).map((r) => r.id)).toEqual([late.id, fresh.id]);
    expect((await list('?tab=due_soon')).map((r) => r.id)).toEqual([late.id]);
    expect((await list('?tab=done')).map((r) => r.id)).toEqual([done.id]);
    expect(await list('?tab=all')).toHaveLength(3);
    expect(await list()).toHaveLength(2); // default = open
  });

  it('searches name, email, business and a mobile typed any way', async () => {
    await make({ requesterName: 'Siti Aminah', requesterEmail: 'siti@example.com', requesterPhone: '+60123334444' });
    await make({ requesterName: 'Raj Kumar', requesterKind: 'customer', businessId: bizId });
    expect((await list('?q=siti')).map((r) => r.requesterName)).toEqual(['Siti Aminah']);
    expect((await list('?q=SITI@EXAMPLE')).map((r) => r.requesterName)).toEqual(['Siti Aminah']);
    expect((await list('?q=0123334444')).map((r) => r.requesterName)).toEqual(['Siti Aminah']);
    expect((await list('?q=laman')).map((r) => r.requesterName)).toEqual(['Raj Kumar']);
    expect(await list('?q=nobody')).toEqual([]);
  });

  it('summary counts open, due within 3 days and overdue', async () => {
    const days = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(Date.now() - n * DAY));
    await make({ receivedOn: days(0) }); // due in 21 days
    await make({ receivedOn: days(19) }); // due in ~2 days
    await make({ receivedOn: days(30) }); // overdue
    const closed = await make();
    await tick(closed.id, 'replied');
    await status(closed.id, 'done');
    expect(await json<PrivacySummary>(await ctx.get('/admin/privacy/summary', nurul))).toEqual({ open: 3, dueSoon: 1, overdue: 1 });
  });
});

describe('working a request', () => {
  it('ticks steps, changes status, and audits each change', async () => {
    const r = await make();
    const stepped = await json<PrivacyRequestDetail>(await tick(r.id, 'id_checked'));
    expect(stepped.checklist.id_checked).toBe(true);
    expect((await json<PrivacyRequestDetail>(await status(r.id, 'in_progress'))).status).toBe('in_progress');
    expect((await tick(r.id, 'id_checked')).status).toBe(200); // same value again: no change, no audit row
    expect((await privacyAudit()).map((a) => a.reason)).toEqual([
      `Request #${r.id} logged · access`,
      `Request #${r.id} · step id_checked done`,
      `Request #${r.id} · status open → in_progress`,
    ]);
    expect(await errCode(await tick(r.id, 'logged', false))).toBe('always_logged');
  });

  it('can only be marked done after the person was replied to; closing stamps the time and reopening clears it', async () => {
    const r = await make();
    const early = await status(r.id, 'done');
    expect(early.status).toBe(409);
    expect(await errCode(early)).toBe('checklist_incomplete');

    await tick(r.id, 'replied');
    const done = await json<PrivacyRequestDetail>(await status(r.id, 'done'));
    expect(done.closedAt).not.toBeNull();
    expect(await errCode(await tick(r.id, 'change_made'))).toBe('closed'); // steps are locked while closed
    expect(await errCode(await status(r.id, 'done'))).toBe('no_change');

    const reopened = await json<PrivacyRequestDetail>(await status(r.id, 'in_progress'));
    expect(reopened.closedAt).toBeNull();
    expect((await list('?tab=open')).map((x) => x.id)).toContain(r.id);
  });

  it('a rejection needs a reason, which is kept in the notes (not the audit log)', async () => {
    const r = await make({ notes: 'asked by email' });
    const res = await status(r.id, 'rejected');
    expect(res.status).toBe(400);
    expect(await errCode(res)).toBe('reason_required');
    const rejected = await json<PrivacyRequestDetail>(await status(r.id, 'rejected', { reason: 'Could not confirm who asked' }));
    expect(rejected.closedAt).not.toBeNull();
    expect(rejected.notes).toBe('asked by email\nRejected: Could not confirm who asked');
    expect(JSON.stringify(await privacyAudit())).not.toContain('Could not confirm');
  });

  it('"sent to business" needs a business; a customer’s request can stay open until they confirm', async () => {
    const own = await make();
    expect(await errCode(await status(own.id, 'sent_to_business'))).toBe('no_business');
    const customer = await make({ requesterKind: 'customer', businessId: bizId, kind: 'deletion' });
    const sent = await json<PrivacyRequestDetail>(await status(customer.id, 'sent_to_business'));
    expect(sent.status).toBe('sent_to_business');
    expect(sent.closedAt).toBeNull();
    expect((await list('?tab=open')).map((r) => r.id)).toContain(customer.id);
  });

  it('notes can be edited; the audit row never carries them', async () => {
    const r = await make();
    const saved = await json<PrivacyRequestDetail>(await ctx.send('POST', `/admin/privacy/${r.id}/notes`, nurul, { notes: 'Called her back' }));
    expect(saved.notes).toBe('Called her back');
    expect(JSON.stringify(await privacyAudit())).not.toContain('Called her back');
    const cleared = await json<PrivacyRequestDetail>(await ctx.send('POST', `/admin/privacy/${r.id}/notes`, nurul, { notes: '' }));
    expect(cleared.notes).toBeNull();
  });

  it('more time adds 14 days once, with a reason, only while open', async () => {
    const r = await make();
    expect((await ctx.send('POST', `/admin/privacy/${r.id}/extend`, nurul, { reason: 'x' })).status).toBe(400); // reason too short
    const extended = await json<PrivacyRequestDetail>(await ctx.send('POST', `/admin/privacy/${r.id}/extend`, nurul, { reason: 'Needs a record from the business' }));
    expect(Date.parse(extended.dueAt) - Date.parse(r.dueAt)).toBe(14 * DAY);
    expect(extended.extendedReason).toBe('Needs a record from the business');
    expect(await errCode(await ctx.send('POST', `/admin/privacy/${r.id}/extend`, nurul, { reason: 'Once more please' }))).toBe('already_extended');

    const other = await make();
    await tick(other.id, 'replied');
    await status(other.id, 'done');
    expect(await errCode(await ctx.send('POST', `/admin/privacy/${other.id}/extend`, nurul, { reason: 'Too late now' }))).toBe('closed');
  });

  it('unknown ids are 404', async () => {
    expect((await ctx.get('/admin/privacy/99999', nurul)).status).toBe(404);
    expect((await status(99999, 'in_progress')).status).toBe(404);
  });
});

describe('deadline days', () => {
  it('counts Malaysia calendar days: 0 today, negative overdue', () => {
    const now = new Date('2026-10-17T02:00:00Z'); // 10:00 on 17 Oct in Malaysia
    expect(privacyDaysLeft('2026-10-17T15:00:00Z', now)).toBe(0); // 23:00 on the 17th is still today in Malaysia
    expect(privacyDaysLeft('2026-10-17T16:30:00Z', now)).toBe(1); // 00:30 on the 18th
    expect(privacyDaysLeft('2026-10-17T05:00:00Z', now)).toBe(0);
    expect(privacyDaysLeft('2026-10-16T05:00:00Z', now)).toBe(-1);
    expect(privacyDaysLeft('2026-11-07T05:00:00Z', now)).toBe(21);
  });
});
