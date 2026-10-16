import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { adminAuditLog, businesses, leads, platformAdmins, supportCases, users } from '@outletbooking/db';
import type { SupportCaseDetail, SupportCaseRow, SupportLead, SupportSummary } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

/** I11 · Support: cases with notes for FTech staff, and website leads. Open to every admin. */
const ctx = createTestContext();

let nurul = ''; // support admin (not a super admin)
let nurulId = 0;
let fadhil = '';
let fadhilId = 0;
let removedId = 0;
let owner = '';
let bizId = 0;

const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const json = async <T>(res: Response, status = 200): Promise<T> => {
  expect(res.status).toBe(status);
  return (await res.json()) as T;
};
const create = async (cookie: string, body: Record<string, unknown>) =>
  json<SupportCaseDetail>(await ctx.send('POST', '/admin/support/cases', cookie, body), 201);
const list = async (qs: string) => json<SupportCaseRow[]>(await ctx.get(`/admin/support/cases${qs}`, nurul));
const supportAudit = async () =>
  (await ctx.db.select().from(adminAuditLog).orderBy(adminAuditLog.id)).filter((a) => a.action === 'support_case_update');

async function makeAdmin(name: string, email: string, role: 'support' | 'super_admin', active = true) {
  const id = await ctx.createUser(name, email);
  await ctx.db.insert(platformAdmins).values({ userId: id, role, isActive: active });
  const cookie = active ? await ctx.login(email, 'password123') : '';
  await ctx.db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, id));
  return { id, cookie };
}

async function addLead(over: Partial<typeof leads.$inferInsert> = {}) {
  const [row] = await ctx.db
    .insert(leads)
    .values({ reason: 'demo', name: 'Aina Clinic', businessName: 'Klinik Aina', phone: '+60123334444', consentAt: new Date(), ...over })
    .returning({ id: leads.id });
  return row!.id;
}

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'owner@example.com', slug: 'sup-biz', businessName: 'Smash Arena PJ', phone: '+60121239999' }))).status).toBe(201);
  owner = await ctx.login('owner@example.com', 'password123');
  bizId = (await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'sup-biz')))[0]!.id;
  ({ id: nurulId, cookie: nurul } = await makeAdmin('Nurul A', 'nurul@ftech.my', 'support'));
  ({ id: fadhilId, cookie: fadhil } = await makeAdmin('Fadhil Z', 'fadhil@ftech.my', 'super_admin'));
  ({ id: removedId } = await makeAdmin('Gone Admin', 'gone@ftech.my', 'support', false));
});

beforeEach(async () => {
  await ctx.db.execute(sql`TRUNCATE support_cases, leads RESTART IDENTITY CASCADE`);
  await ctx.db.delete(adminAuditLog);
});

afterAll(() => ctx.close());

describe('access', () => {
  it('needs an admin session; owners are refused; a Support admin can use all of it', async () => {
    for (const path of ['/admin/support/summary', '/admin/support/cases', '/admin/support/leads']) {
      expect((await ctx.get(path)).status).toBe(401);
      expect((await ctx.get(path, owner)).status).toBe(403);
      expect((await ctx.get(path, nurul)).status).toBe(200);
    }
  });
});

describe('cases', () => {
  it('opens a case for a business with the owner’s message, assigned to whoever opened it; audited without the note text', async () => {
    const detail = await create(nurul, {
      title: 'ToyyibPay test payment fails',
      source: 'whatsapp',
      businessId: bizId,
      note: 'I pasted my key but the RM 1 test says failed.',
      noteKind: 'owner_message',
    });
    expect(detail).toMatchObject({
      title: 'ToyyibPay test payment fails',
      status: 'open',
      source: 'whatsapp',
      business: { id: bizId, name: 'Smash Arena PJ' },
      assignedTo: { id: nurulId, name: 'Nurul A' },
      fromLead: false,
      closedAt: null,
      businessInfo: { id: bizId, name: 'Smash Arena PJ', ownerName: 'Ali Hassan', phone: '+60121239999' },
    });
    expect(detail.businessInfo!.trialEndsAt).not.toBeNull();
    expect(detail.notes).toMatchObject([{ kind: 'owner_message', body: 'I pasted my key but the RM 1 test says failed.', admin: { name: 'Nurul A' } }]);

    const log = await supportAudit();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      adminUserId: nurulId,
      businessId: bizId,
      reason: `Case #${detail.id} opened: ToyyibPay test payment fails`,
    });
    expect(JSON.stringify(log)).not.toContain('pasted my key');
  });

  it('validates the title and refuses a business or lead that does not exist', async () => {
    expect((await ctx.send('POST', '/admin/support/cases', nurul, { title: 'ab', source: 'email' })).status).toBe(400);
    expect((await ctx.send('POST', '/admin/support/cases', nurul, { title: 'Valid title', source: 'fax' })).status).toBe(400);
    expect((await ctx.send('POST', '/admin/support/cases', nurul, { title: 'Valid title', source: 'email', businessId: 999999 })).status).toBe(404);
    expect((await ctx.send('POST', '/admin/support/cases', nurul, { title: 'Valid title', source: 'email', leadId: 999999 })).status).toBe(404);
    expect(await ctx.db.select().from(supportCases)).toHaveLength(0);
  });

  it('lists by status, newest activity first, and searches title and business name', async () => {
    const a = await create(nurul, { title: 'Trial extension please', source: 'whatsapp' });
    const b = await create(nurul, { title: 'WhatsApp link missing', source: 'email', businessId: bizId });
    await ctx.send('POST', `/admin/support/cases/${a.id}/status`, nurul, { status: 'waiting' });

    expect((await list('')).map((c) => c.id)).toEqual([b.id]);
    expect((await list('?status=waiting')).map((c) => c.id)).toEqual([a.id]);
    expect((await list('?status=closed'))).toEqual([]);
    expect((await list('?q=smash')).map((c) => c.id)).toEqual([b.id]);
    expect((await list('?status=waiting&q=TRIAL')).map((c) => c.id)).toEqual([a.id]);
    expect((await ctx.get('/admin/support/cases?status=nope', nurul)).status).toBe(400);

    // A new note moves a case to the top.
    const c = await create(nurul, { title: 'Third case', source: 'phone' });
    expect((await list('')).map((r) => r.id)).toEqual([c.id, b.id]);
    await ctx.send('POST', `/admin/support/cases/${b.id}/notes`, fadhil, { body: 'Called back' });
    expect((await list('')).map((r) => r.id)).toEqual([b.id, c.id]);
  });

  it('notes: internal by default, can be an owner message; empty is refused; audit has no note text', async () => {
    const c = await create(nurul, { title: 'Customer did not get link', source: 'email' });
    const path = `/admin/support/cases/${c.id}/notes`;
    expect((await ctx.send('POST', path, nurul, { body: '   ' })).status).toBe(400);

    const one = await json<SupportCaseDetail>(await ctx.send('POST', path, nurul, { body: 'Checked the Resend log' }), 201);
    const two = await json<SupportCaseDetail>(
      await ctx.send('POST', path, fadhil, { body: 'Owner says “nothing arrived”', kind: 'owner_message' }),
      201,
    );
    expect(one.notes.map((n) => n.kind)).toEqual(['internal']);
    expect(two.notes.map((n) => [n.kind, n.admin?.name])).toEqual([
      ['internal', 'Nurul A'],
      ['owner_message', 'Fadhil Z'],
    ]);
    const log = await supportAudit();
    expect(log.map((a) => a.reason)).toEqual([
      `Case #${c.id} opened: Customer did not get link`,
      `Case #${c.id} · note added`,
      `Case #${c.id} · owner message added`,
    ]);
    expect(JSON.stringify(log)).not.toContain('Resend log');
    expect((await ctx.send('POST', '/admin/support/cases/999999/notes', nurul, { body: 'x' })).status).toBe(404);
  });

  it('status: waiting, closed (closing time kept), reopened; the same status is refused; counts follow', async () => {
    const c = await create(nurul, { title: 'Wants two more weeks', source: 'whatsapp' });
    const set = (status: string) => ctx.send('POST', `/admin/support/cases/${c.id}/status`, nurul, { status });
    expect(((await json<SupportCaseDetail>(await set('waiting'))).status)).toBe('waiting');
    expect(await errCode(await set('waiting'))).toBe('no_change');

    const closed = await json<SupportCaseDetail>(await set('closed'));
    expect(closed.status).toBe('closed');
    expect(Date.now() - Date.parse(closed.closedAt!)).toBeLessThan(60_000);
    expect(await json<SupportSummary>(await ctx.get('/admin/support/summary', nurul))).toEqual({
      open: 0,
      waiting: 0,
      closed: 1,
      leads: 0,
      newLeads: 0,
    });

    const reopened = await json<SupportCaseDetail>(await set('open'));
    expect(reopened).toMatchObject({ status: 'open', closedAt: null });
    expect((await supportAudit()).map((a) => a.reason).slice(1)).toEqual([
      `Case #${c.id} · status open → waiting`,
      `Case #${c.id} · status waiting → closed`,
      `Case #${c.id} · status closed → open`,
    ]);
    expect((await ctx.send('POST', `/admin/support/cases/${c.id}/status`, nurul, { status: 'archived' })).status).toBe(400);
  });

  it('assign: to an active admin or to nobody; a removed admin or no change is refused', async () => {
    const c = await create(nurul, { title: 'Needs a call', source: 'phone' });
    const assign = (adminUserId: number | null) => ctx.send('POST', `/admin/support/cases/${c.id}/assign`, nurul, { adminUserId });

    expect((await json<SupportCaseDetail>(await assign(fadhilId))).assignedTo).toEqual({ id: fadhilId, name: 'Fadhil Z' });
    expect(await errCode(await assign(fadhilId))).toBe('no_change');
    const removed = await assign(removedId);
    expect(removed.status).toBe(400);
    expect(await errCode(removed)).toBe('unknown_admin');
    expect((await json<SupportCaseDetail>(await assign(null))).assignedTo).toBeNull();
    expect((await supportAudit()).map((a) => a.reason).slice(1)).toEqual([
      `Case #${c.id} · assigned to Fadhil Z`,
      `Case #${c.id} · assigned to nobody`,
    ]);
  });
});

describe('website leads', () => {
  it('lists leads still being worked on, with filters, search and counts', async () => {
    const demo = await addLead();
    const question = await addLead({ reason: 'question', name: 'Hafiz', businessName: null, phone: null, email: 'hafiz@example.com', message: 'Do you support WhatsApp?' });
    const lost = await addLead({ name: 'Old lead', status: 'lost' });
    const won = await addLead({ name: 'Happy customer', status: 'won' });
    await ctx.db.update(leads).set({ status: 'contacted' }).where(eq(leads.id, question));

    const fetchLeads = async (qs = '') => (await json<{ leads: SupportLead[] } | SupportLead[]>(await ctx.get(`/admin/support/leads${qs}`, nurul))) as SupportLead[];
    expect((await fetchLeads()).map((l) => l.id).sort()).toEqual([demo, question].sort());
    expect((await fetchLeads('?status=lost')).map((l) => l.id)).toEqual([lost]);
    expect((await fetchLeads('?status=won')).map((l) => l.id)).toEqual([won]);
    expect((await fetchLeads('?q=hafiz@example')).map((l) => l.id)).toEqual([question]);
    expect((await fetchLeads('?q=klinik')).map((l) => l.id)).toEqual([demo]);
    // Phone: a local number, with spaces or dashes, finds the stored +60 number.
    expect((await fetchLeads('?q=0123334444')).map((l) => l.id)).toEqual([demo]);
    expect((await fetchLeads('?q=012-333%204444')).map((l) => l.id)).toEqual([demo]);
    expect((await fetchLeads('?q=%2B60123334444')).map((l) => l.id)).toEqual([demo]);
    expect(await fetchLeads('?q=44')).toEqual([]);

    const first = (await fetchLeads()).find((l) => l.id === demo)!;
    expect(first).toMatchObject({ reason: 'demo', name: 'Aina Clinic', businessName: 'Klinik Aina', status: 'new', caseId: null });
    expect(await json<SupportSummary>(await ctx.get('/admin/support/summary', nurul))).toMatchObject({ leads: 2, newLeads: 1 });
  });

  it('phone search compares digits only, so spaces and dashes in a stored number do not matter', async () => {
    const id = await addLead({ name: 'Spaced', phone: '+60 12-333 5555' });
    const res = await ctx.get('/admin/support/leads?q=0123335555', nurul);
    expect(((await res.json()) as SupportLead[]).map((l) => l.id)).toEqual([id]);
    const none = await ctx.get('/admin/support/leads?q=zzz', nurul);
    expect(((await none.json()) as SupportLead[]).map((l) => l.id)).toEqual([]);
  });

  it('changes a lead’s status (audited); the same status is refused', async () => {
    const id = await addLead();
    const res = await ctx.send('POST', `/admin/support/leads/${id}/status`, nurul, { status: 'contacted' });
    expect(await json<SupportLead>(res)).toMatchObject({ id, status: 'contacted' });
    expect(await errCode(await ctx.send('POST', `/admin/support/leads/${id}/status`, nurul, { status: 'contacted' }))).toBe('no_change');
    expect((await ctx.send('POST', '/admin/support/leads/999999/status', nurul, { status: 'won' })).status).toBe(404);
    expect((await ctx.send('POST', `/admin/support/leads/${id}/status`, nurul, { status: 'maybe' })).status).toBe(400);
    expect((await supportAudit()).map((a) => [a.reason, a.businessId])).toEqual([[`Lead #${id} · status new → contacted`, null]]);
  });

  it('turns a lead into a case that carries the lead’s details', async () => {
    const leadId = await addLead({ message: 'We have 2 branches' });
    const detail = await create(nurul, { title: 'Demo request · 2 branches', source: 'website', leadId });
    expect(detail.fromLead).toBe(true);
    expect(detail.lead).toMatchObject({ id: leadId, name: 'Aina Clinic', message: 'We have 2 branches', caseId: detail.id });
    const [lead] = (await json<SupportLead[]>(await ctx.get('/admin/support/leads', nurul)));
    expect(lead!.caseId).toBe(detail.id);
  });
});
