import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, subMonths } from 'date-fns';
import { eq, sql } from 'drizzle-orm';
import { adminAuditLog, businesses, businessMembers, emailEvents, payments, platformAdmins, subscriptions, users } from '@outletbooking/db';
import type { AdminBusinessDetail, AuditEntry, CheckoutResult, DeletionQueue, Resource, Service } from '@outletbooking/shared';
import {
  DELETION_MAX_PER_RUN,
  TENANT_TABLES_DELETED,
  TENANT_TABLES_KEPT,
  deleteBusinessData,
  isUnpaidFor,
  runDataDeletion,
} from '../src/services/admin-deletion';
import { businessPrefix } from '../src/services/storage';
import { createTestContext, signupInput } from './helpers';

/** I26 · Data deletion: who is in the queue, the notice, hold / release, close, and what the daily job deletes (and keeps). */
const ctx = createTestContext({ PLATFORM_TOYYIBPAY_SECRET_KEY: 'platform-secret', PLATFORM_TOYYIBPAY_CATEGORY_CODE: 'platcat' });
const DAY = 86_400_000;
const NOW = new Date();

let boss = ''; // super admin
let nurul = ''; // support admin
let bossId = 0;
const owners: Record<string, string> = {};
const ids: Record<string, number> = {};

const json = async <T>(res: Response, status = 200): Promise<T> => {
  expect(res.status).toBe(status);
  return (await res.json()) as T;
};
const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const queue = async (tab = 'todo', cookie = nurul) => json<DeletionQueue>(await ctx.get(`/admin/deletion?tab=${tab}`, cookie));
const names = (q: DeletionQueue) => q.rows.map((r) => r.name).sort();
const setBiz = (key: string, values: Partial<typeof businesses.$inferInsert>) => ctx.db.update(businesses).set(values).where(eq(businesses.id, ids[key]!));
const setSub = (key: string, values: Partial<typeof subscriptions.$inferInsert>) => ctx.db.update(subscriptions).set(values).where(eq(subscriptions.businessId, ids[key]!));
const bizRow = async (key: string) => (await ctx.db.select().from(businesses).where(eq(businesses.id, ids[key]!)))[0]!;
const deletionAudit = async () => (await ctx.db.select().from(adminAuditLog).orderBy(adminAuditLog.id)).filter((a) => ['send_deletion_notice', 'hold_deletion', 'release_deletion', 'delete_business_data', 'close_account'].includes(a.action));
const runDeps = (over: { enabled?: boolean } = {}) => ({
  db: ctx.db,
  env: { ...ctx.env, DATA_DELETION_ENABLED: over.enabled ?? true },
  mailer: { send: async () => undefined },
  storage: ctx.storage,
});
/** Plan ended this many months ago. */
const unpaidFor = (months: number) => ({ plan: 'starter', status: 'active', trialEndsAt: subMonths(NOW, months + 2), currentPeriodStart: subMonths(NOW, months + 1), currentPeriodEnd: subMonths(NOW, months), freeUntil: null });
const mails = () => ctx.outbox.filter((m) => m.subject.startsWith('Your OutletBooking data will be deleted'));

async function makeAdmin(name: string, email: string, role: 'support' | 'super_admin') {
  const id = await ctx.createUser(name, email);
  await ctx.db.insert(platformAdmins).values({ userId: id, role, isActive: true });
  const cookie = await ctx.login(email, 'password123');
  await ctx.db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, id));
  return { id, cookie };
}

async function signup(key: string, name: string, template = 'sports') {
  const email = `${key}@example.com`;
  expect((await ctx.post('/signup', signupInput({ email, slug: `del-${key}`, businessName: name, template: template as 'sports' }))).status).toBe(201);
  owners[key] = await ctx.login(email, 'password123');
  ids[key] = (await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, `del-${key}`)))[0]!.id;
}

/** A business of its own for a test that deletes it (deleting removes its logins, so others must not share it). */
async function disposable(key: string, name: string, withData = false) {
  await signup(key, name);
  if (withData) await fillBusiness(key); // while it still has a plan: an expired one cannot change anything
  await setSub(key, unpaidFor(13));
}

/** A court, a service, a customer's booking, a staff member, a notification and a stored file: real data to delete. */
async function fillBusiness(key: string) {
  const owner = owners[key]!;
  const court = await json<Resource>(await ctx.send('POST', '/resources', owner, { name: 'Court 1', resourceType: 'court' }), 201);
  const allWeek = { hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '00:00', endTime: '23:59' })) };
  await json(await ctx.send('PUT', `/resources/${court.id}/working-hours`, owner, allWeek));
  const service = await json<Service>(await ctx.send('POST', '/services', owner, { name: 'Court hire', durationMin: 60, priceSen: 2000, resourceIds: [court.id] }), 201);
  const start = new Date(Date.now() + 3 * DAY);
  start.setUTCHours(4, 0, 0, 0);
  await json(await ctx.send('POST', '/bookings', owner, { serviceId: service.id, resourceId: court.id, startAt: start.toISOString(), customer: { name: 'Test Customer', phone: '+60123456789' } }), 201);
  const staffId = await ctx.createUser(`Staff ${key}`, `staff-${key}@example.com`);
  await ctx.db.insert(businessMembers).values({ businessId: ids[key]!, userId: staffId, role: 'staff' });
  ctx.storage.objects.set(`${businessPrefix(ids[key]!)}photo.jpg`, { body: new Uint8Array([1]), contentType: 'image/jpeg' });
}

/** FTech's own record: a paid plan payment with a receipt. */
async function payPlan(key: string) {
  const details = { companyName: 'Smash Arena Sdn Bhd', receiptEmail: 'accounts@smasharena.my' };
  const { ref } = await json<CheckoutResult>(await ctx.send('POST', '/billing/checkout', owners[key]!, { plan: 'starter', details }), 201);
  ctx.toyyibpay.pay(ref);
  await ctx.app.request('/toyyibpay/plan-callback', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ status_id: '1', billcode: ref, order_id: 'OBP_TEST', refno: 'TPREF1' }),
  });
  return ref;
}

beforeAll(async () => {
  await ctx.reset();
  await signup('a', 'Barber Shop', 'barber_salon'); // the business that gets deleted
  await signup('b', 'Tuition Centre', 'tuition'); // no plan, but only recently
  await signup('c', 'Car Wash', 'workshop'); // paying
  await signup('d', 'Futsal Seri', 'sports'); // no plan for 13 months
  ({ id: bossId, cookie: boss } = await makeAdmin('Fadhil Z', 'fadhil@ftech.my', 'super_admin'));
  ({ cookie: nurul } = await makeAdmin('Nurul A', 'nurul@ftech.my', 'support'));
});

beforeEach(async () => {
  await ctx.db.delete(adminAuditLog);
  ctx.outbox.length = 0;
  for (const key of ['a', 'b', 'c', 'd']) {
    await setBiz(key, { deletedAt: null, closeRequestedAt: null, deletionNoticeSentAt: null, deletionDueAt: null, deletionHoldReason: null, name: { a: 'Barber Shop', b: 'Tuition Centre', c: 'Car Wash', d: 'Futsal Seri' }[key]! });
  }
  await setSub('a', unpaidFor(13));
  await setSub('b', unpaidFor(2));
  await setSub('c', { plan: 'starter', status: 'active', currentPeriodEnd: addDays(NOW, 20) });
  await setSub('d', unpaidFor(14));
});

afterAll(() => ctx.close());

describe('who counts as unpaid for 12 months', () => {
  const sub = (over: Partial<Parameters<typeof isUnpaidFor>[0] & object> = {}) => ({ status: 'active', trialEndsAt: subMonths(NOW, 20), currentPeriodEnd: subMonths(NOW, 12), freeUntil: null, ...over });
  const created = subMonths(NOW, 30);
  it('needs the last plan or trial to have ended 12 months ago, grace days included', () => {
    expect(isUnpaidFor(sub(), created, 12, 3, NOW)).toBe(true);
    expect(isUnpaidFor(sub({ currentPeriodEnd: subMonths(NOW, 11) }), created, 12, 3, NOW)).toBe(false);
    expect(isUnpaidFor(sub({ currentPeriodEnd: subMonths(NOW, 12) }), created, 12, 3, NOW)).toBe(true);
    // Free months count as a plan: the clock starts when they end.
    expect(isUnpaidFor(sub({ freeUntil: subMonths(NOW, 5) }), created, 12, 3, NOW)).toBe(false);
    // A trial that never turned into a plan counts from its end.
    expect(isUnpaidFor(sub({ status: 'trialing', currentPeriodEnd: null, trialEndsAt: subMonths(NOW, 13) }), created, 12, 3, NOW)).toBe(true);
    expect(isUnpaidFor(sub({ status: 'trialing', currentPeriodEnd: null, trialEndsAt: addDays(NOW, 2) }), created, 12, 3, NOW)).toBe(false);
  });
  it('an open-ended plan (set by FTech) and a paying business never count', () => {
    expect(isUnpaidFor(sub({ status: 'active', currentPeriodEnd: null }), created, 12, 3, NOW)).toBe(false);
    expect(isUnpaidFor(sub({ currentPeriodEnd: addDays(NOW, 5) }), created, 12, 3, NOW)).toBe(false);
  });
});

describe('the queue', () => {
  it('needs an admin; every admin role can read it', async () => {
    expect((await ctx.get('/admin/deletion')).status).toBe(401);
    expect((await ctx.get('/admin/deletion', owners.a!)).status).toBe(403);
    expect((await ctx.get('/admin/deletion', nurul)).status).toBe(200);
  });

  it('lists businesses with no plan for 12 months under "to do", with the months', async () => {
    const q = await queue('todo');
    expect(names(q)).toEqual(['Barber Shop', 'Futsal Seri']);
    expect(q.rows.find((r) => r.name === 'Barber Shop')).toMatchObject({ reason: 'unpaid', unpaidMonths: 13, noticeSentAt: null, deleteOn: null, tab: 'todo', template: 'barber_salon' });
    expect(q.summary).toMatchObject({ noticeToSend: 2, deletingSoon: 0, onHold: 0, deletedThisYear: 0, autoDeleteEnabled: false });
  });

  it('shows the paying and the recently ended businesses nowhere', async () => {
    for (const tab of ['todo', 'notice_sent', 'on_hold', 'done']) {
      expect((await queue(tab)).rows.map((r) => r.name)).not.toContain('Car Wash');
      expect((await queue(tab)).rows.map((r) => r.name)).not.toContain('Tuition Centre');
    }
  });

  it('puts an owner’s close request under "notice sent" with its delete date', async () => {
    await json<AdminBusinessDetail>(await ctx.send('POST', `/admin/businesses/${ids.c}/close`, boss, { reason: 'Owner asked in writing on 2 Oct' }));
    const q = await queue('notice_sent');
    const row = q.rows.find((r) => r.name === 'Car Wash')!;
    expect(row).toMatchObject({ reason: 'close_request', tab: 'notice_sent' });
    expect(Math.round((Date.parse(row.deleteOn!) - Date.now()) / DAY)).toBe(90);
    expect(q.summary.deletingSoon).toBe(0); // 90 days away
  });
});

describe('send notice', () => {
  it('emails the owner the delete date, starts the 30 days, and is logged', async () => {
    expect((await ctx.send('POST', `/admin/deletion/${ids.a}/notice`, boss)).status).toBe(204);
    const sent = mails();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('a@example.com');
    expect(sent[0]!.text).toContain('Barber Shop');
    const row = await bizRow('a');
    expect(row.deletionNoticeSentAt).not.toBeNull();
    expect(Math.round((row.deletionDueAt!.getTime() - Date.now()) / DAY)).toBe(30);
    const q = await queue('notice_sent');
    expect(q.rows[0]).toMatchObject({ name: 'Barber Shop', tab: 'notice_sent' });
    expect(q.summary).toMatchObject({ noticeToSend: 1, deletingSoon: 1 });
    const audit = await deletionAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ adminUserId: bossId, businessId: ids.a, action: 'send_deletion_notice' });
    const [event] = await ctx.db.select().from(emailEvents).where(eq(emailEvents.template, 'deletion_notice'));
    expect(event).toBeUndefined(); // the test mailer is not tracked; production wraps it (I27)
  });

  it('is for super admins only, and refuses what is not due, already sent, on hold, or closing', async () => {
    expect((await ctx.send('POST', `/admin/deletion/${ids.a}/notice`, nurul)).status).toBe(403);
    expect(await errCode(await ctx.send('POST', `/admin/deletion/${ids.b}/notice`, boss))).toBe('not_eligible'); // ended 2 months ago
    expect(await errCode(await ctx.send('POST', `/admin/deletion/${ids.c}/notice`, boss))).toBe('not_eligible'); // paying
    expect((await ctx.send('POST', `/admin/deletion/${ids.a}/notice`, boss)).status).toBe(204);
    expect(await errCode(await ctx.send('POST', `/admin/deletion/${ids.a}/notice`, boss))).toBe('already_sent');
    await ctx.send('POST', `/admin/deletion/${ids.d}/hold`, boss, { reason: 'Owner coming back in Dec' });
    expect(await errCode(await ctx.send('POST', `/admin/deletion/${ids.d}/notice`, boss))).toBe('on_hold');
    await ctx.send('POST', `/admin/businesses/${ids.b}/close`, boss, { reason: 'Owner asked in writing' });
    expect(await errCode(await ctx.send('POST', `/admin/deletion/${ids.b}/notice`, boss))).toBe('close_request');
    expect((await ctx.send('POST', '/admin/deletion/99999/notice', boss)).status).toBe(404);
  });

  it('does not start the clock when the notice could not be emailed', async () => {
    const failing = { ...runDeps(), mailer: { send: async () => Promise.reject(new Error('Resend is down')) } };
    const { sendDeletionNotice } = await import('../src/services/admin-deletion');
    await expect(sendDeletionNotice(failing, bossId, ids.a!)).rejects.toMatchObject({ code: 'no_email_sent' });
    const row = await bizRow('a');
    expect(row.deletionNoticeSentAt).toBeNull();
    expect(row.deletionDueAt).toBeNull();
    expect(await deletionAudit()).toHaveLength(0);
  });
});

describe('hold and release', () => {
  it('a hold needs a reason, moves the business to "on hold", and is logged', async () => {
    expect((await ctx.send('POST', `/admin/deletion/${ids.d}/hold`, boss, { reason: 'x' })).status).toBe(400);
    expect((await ctx.send('POST', `/admin/deletion/${ids.d}/hold`, nurul, { reason: 'Owner coming back in Dec' })).status).toBe(403);
    expect((await ctx.send('POST', `/admin/deletion/${ids.d}/hold`, boss, { reason: 'Owner coming back in Dec' })).status).toBe(204);
    expect(await errCode(await ctx.send('POST', `/admin/deletion/${ids.d}/hold`, boss, { reason: 'Second hold again' }))).toBe('already_on_hold');
    const q = await queue('on_hold');
    expect(q.rows).toMatchObject([{ name: 'Futsal Seri', holdReason: 'Owner coming back in Dec', tab: 'on_hold' }]);
    expect(q.summary.onHold).toBe(1);
    expect((await deletionAudit())[0]).toMatchObject({ action: 'hold_deletion', reason: 'Owner coming back in Dec' });
  });

  it('releasing never leaves less than 7 days when the delete date has already passed', async () => {
    await setBiz('d', { deletionNoticeSentAt: addDays(NOW, -40), deletionDueAt: addDays(NOW, -10), deletionHoldReason: 'Owner coming back in Dec' });
    expect(await errCode(await ctx.send('POST', `/admin/deletion/${ids.a}/release`, boss, { reason: 'Not on hold anyway' }))).toBe('not_on_hold');
    expect((await ctx.send('POST', `/admin/deletion/${ids.d}/release`, boss, { reason: 'Owner did not come back' })).status).toBe(204);
    const row = await bizRow('d');
    expect(row.deletionHoldReason).toBeNull();
    expect(Math.round((row.deletionDueAt!.getTime() - Date.now()) / DAY)).toBe(7);
    // …and a date that is still far away is left alone.
    await setBiz('d', { deletionDueAt: addDays(NOW, 20), deletionHoldReason: 'Again' });
    await ctx.send('POST', `/admin/deletion/${ids.d}/release`, boss, { reason: 'Back in the queue' });
    expect(Math.round(((await bizRow('d')).deletionDueAt!.getTime() - Date.now()) / DAY)).toBe(20);
  });
});

describe('close account (I2)', () => {
  it('closes the booking page at once, sets the 90-day date, and can be undone', async () => {
    const closed = await json<AdminBusinessDetail>(await ctx.send('POST', `/admin/businesses/${ids.c}/close`, boss, { reason: 'Owner asked in writing on 2 Oct' }));
    expect(closed.closing).not.toBeNull();
    expect((await ctx.get('/public/del-c')).status).toBe(410); // F6 "closed"
    expect(await errCode(await ctx.send('POST', `/admin/businesses/${ids.c}/close`, boss, { reason: 'Twice by mistake' }))).toBe('already_closed');
    expect((await ctx.send('POST', `/admin/businesses/${ids.c}/close`, nurul, { reason: 'Support cannot close' })).status).toBe(403);

    const reopened = await json<AdminBusinessDetail>(await ctx.send('POST', `/admin/businesses/${ids.c}/reopen`, boss, { reason: 'Owner changed their mind' }));
    expect(reopened.closing).toBeNull();
    expect((await ctx.get('/public/del-c')).status).toBe(200);
    const row = await bizRow('c');
    expect(row).toMatchObject({ closeRequestedAt: null, deletionDueAt: null });
    expect(await errCode(await ctx.send('POST', `/admin/businesses/${ids.c}/reopen`, boss, { reason: 'Not closed anyway' }))).toBe('not_closed');
    expect((await deletionAudit()).map((a) => a.action)).toEqual(['close_account', 'close_account']);
  });
});

describe('the daily job', () => {
  const ready = async (key: string, over: Partial<typeof businesses.$inferInsert> = {}) =>
    setBiz(key, { deletionNoticeSentAt: addDays(NOW, -31), deletionDueAt: addDays(NOW, -1), ...over });

  it('does nothing when automatic deletion is off for the server', async () => {
    await ready('a');
    expect(await runDataDeletion(runDeps({ enabled: false }))).toEqual({ skipped: true, deleted: [], cleared: [] });
    expect((await bizRow('a')).deletedAt).toBeNull();
  });

  it('deletes what is due, unpaid and not on hold — and leaves everything else alone', async () => {
    await disposable('j1', 'Barber Gone', true);
    await disposable('j2', 'Control Shop', true);
    await ready('j1');
    await ready('d', { deletionHoldReason: 'Owner coming back in Dec' }); // on hold
    await ready('j2', { deletionDueAt: addDays(NOW, 5) }); // not yet
    const run = await runDataDeletion(runDeps());
    expect(run).toEqual({ skipped: false, deleted: [ids.j1], cleared: [] });

    // Barber Shop: the row stays with its name only; its data and logins are gone.
    const a = await bizRow('j1');
    expect(a.name).toBe('Barber Gone');
    expect(a.deletedAt).not.toBeNull();
    expect(a).toMatchObject({ phone: null, address: null, bookingEnabled: false, settings: {} });
    expect(await ctx.db.select().from(users).where(eq(users.email, 'j1@example.com'))).toEqual([]);
    expect(await ctx.db.select().from(users).where(eq(users.email, 'staff-j1@example.com'))).toEqual([]);
    expect([...ctx.storage.objects.keys()].filter((k) => k.startsWith(businessPrefix(ids.j1!)))).toEqual([]);
    expect((await ctx.get('/public/del-j1')).status).toBe(410);

    // Everyone else is untouched, including their files and logins.
    expect((await bizRow('j2')).deletedAt).toBeNull();
    expect((await bizRow('d')).deletedAt).toBeNull();
    expect(await ctx.db.select().from(users).where(eq(users.email, 'j2@example.com'))).toHaveLength(1);
    expect((await ctx.get('/bookings?from=2000-01-01', owners.j2!)).status).toBeLessThan(500);
    expect([...ctx.storage.objects.keys()].some((k) => k.startsWith(businessPrefix(ids.j2!)))).toBe(true);

    // The system's own audit row: no admin, and counts — not who the customers were.
    const [log] = (await deletionAudit()).filter((x) => x.action === 'delete_business_data');
    expect(log).toMatchObject({ adminUserId: null, businessId: ids.j1 });
    expect(JSON.stringify(log)).not.toMatch(/Test Customer|0123456789/);
    expect(log!.details).toMatchObject({ customers: 1, bookings: 1 });

    // Run again: nothing more to do.
    expect(await runDataDeletion(runDeps())).toEqual({ skipped: false, deleted: [], cleared: [] });
  });

  it('keeps FTech’s plan payments and receipts, and deletes the business’s own customer payments', async () => {
    await disposable('j3', 'Receipt Shop');
    const ref = await payPlan('j3');
    const [plan] = await ctx.db.select().from(payments).where(eq(payments.billCode, ref));
    expect(plan!.receiptNo).toMatch(/^OB-/);
    await setSub('j3', unpaidFor(13));
    await ready('j3');
    await runDataDeletion(runDeps());
    const kept = await ctx.db.select().from(payments).where(eq(payments.businessId, ids.j3!));
    expect(kept.map((p) => p.purpose)).toEqual(['subscription']);
    expect(kept[0]).toMatchObject({ billCode: ref, status: 'paid', receiptNo: plan!.receiptNo });
    expect((kept[0]!.receiptSnapshot as { companyName: string }).companyName).toBe('Smash Arena Sdn Bhd');
    expect((await ctx.db.select().from(subscriptions).where(eq(subscriptions.businessId, ids.j3!))).length).toBe(1);
  });

  it('a business that paid again is not deleted: its notice and date are cleared', async () => {
    await ready('a');
    await setSub('a', { plan: 'starter', status: 'active', currentPeriodEnd: addDays(NOW, 25) });
    expect(await runDataDeletion(runDeps())).toEqual({ skipped: false, deleted: [], cleared: [ids.a] });
    const a = await bizRow('a');
    expect(a).toMatchObject({ deletedAt: null, deletionNoticeSentAt: null, deletionDueAt: null });
    expect((await deletionAudit()).at(-1)).toMatchObject({ action: 'release_deletion', adminUserId: null });
  });

  it('a close request is deleted when its date passes, without a notice', async () => {
    await disposable('j4', 'Closing Shop');
    await setSub('j4', { plan: 'starter', status: 'active', currentPeriodEnd: addDays(NOW, 20) }); // paying: a close request does not need unpaid
    await ready('j4', { closeRequestedAt: addDays(NOW, -91), deletionNoticeSentAt: null, deletionDueAt: addDays(NOW, -1) });
    expect((await runDataDeletion(runDeps())).deleted).toEqual([ids.j4]);
    expect((await bizRow('j4')).deletedAt).not.toBeNull();
  });

  it('never deletes a business whose notice was not sent, even if it somehow has a past date', async () => {
    await setBiz('a', { deletionDueAt: addDays(NOW, -1) }); // no notice
    expect(await runDataDeletion(runDeps())).toEqual({ skipped: false, deleted: [], cleared: [ids.a] });
    expect((await bizRow('a')).deletedAt).toBeNull();
  });

  it('deletes at most ten businesses in one run', async () => {
    const extra: number[] = [];
    for (let i = 0; i < DELETION_MAX_PER_RUN + 2; i++) {
      const [b] = await ctx.db
        .insert(businesses)
        .values({ name: `Bulk ${i}`, slug: `bulk-${i}`, template: 'other', resourceLabel: 'Resource', deletionNoticeSentAt: addDays(NOW, -31), deletionDueAt: addDays(NOW, -1) })
        .returning({ id: businesses.id });
      await ctx.db.insert(subscriptions).values({ businessId: b!.id, plan: 'starter', status: 'expired', trialEndsAt: subMonths(NOW, 20), currentPeriodEnd: subMonths(NOW, 15) });
      extra.push(b!.id);
    }
    try {
      expect((await runDataDeletion(runDeps())).deleted).toHaveLength(DELETION_MAX_PER_RUN);
      expect((await runDataDeletion(runDeps())).deleted.length).toBe(2);
    } finally {
      await ctx.db.execute(sql`delete from businesses where slug like 'bulk-%'`);
    }
  });

  it('cannot delete the same business twice, and the audit log shows the system as the actor', async () => {
    await disposable('j5', 'Twice Shop');
    await ready('j5');
    await runDataDeletion(runDeps());
    await expect(deleteBusinessData(runDeps(), ids.j5!)).rejects.toMatchObject({ code: 'already_deleted' });
    const entries = await json<AuditEntry[]>(await ctx.get(`/admin/audit-log?businessId=${ids.j5}`, nurul));
    expect(entries.find((e) => e.action === 'delete_business_data')).toMatchObject({ admin: null });
    const csv = await (await ctx.get('/admin/audit-log/export', boss)).text();
    expect(csv).toContain('System,delete_business_data');
    expect((await queue('done')).rows.map((r) => r.name)).toContain('Twice Shop');
    expect((await queue('done')).summary.deletedThisYear).toBeGreaterThanOrEqual(1);
  });
});

describe('every table that holds a business’s data is covered', () => {
  it('each table with a business_id column is either emptied or deliberately kept', async () => {
    const rows = (await ctx.db.execute(sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'business_id' order by 1`)) as unknown as { table_name: string }[];
    const found = rows.map((r) => r.table_name).sort();
    const covered = [...TENANT_TABLES_DELETED, ...TENANT_TABLES_KEPT].sort();
    expect(found).toEqual(covered);
  });

  it('after a deletion, the emptied tables hold nothing for that business and the kept ones only FTech’s own records', async () => {
    await disposable('j6', 'Coverage Shop', true);
    await setSub('j6', { plan: 'trial', status: 'trialing', trialEndsAt: addDays(NOW, 3), currentPeriodEnd: null });
    await payPlan('j6');
    await ctx.db.update(businesses).set({ deletionNoticeSentAt: addDays(NOW, -31), deletionDueAt: addDays(NOW, -1) }).where(eq(businesses.id, ids.j6!));
    await setSub('j6', unpaidFor(13));
    await runDataDeletion(runDeps());
    for (const table of TENANT_TABLES_DELETED) {
      const [r] = (await ctx.db.execute(sql`select count(*)::int as n from ${sql.identifier(table)} where business_id = ${ids.j6!}`)) as unknown as { n: number }[];
      expect(r!.n, `${table} still has rows for the deleted business`).toBe(0);
    }
    const [bookingMoney] = (await ctx.db.execute(sql`select count(*)::int as n from payments where business_id = ${ids.j6!} and purpose <> 'subscription'`)) as unknown as { n: number }[];
    expect(bookingMoney!.n).toBe(0);
    const [bookingRefunds] = (await ctx.db.execute(sql`select count(*)::int as n from refunds where business_id = ${ids.j6!} and booking_id is not null`)) as unknown as { n: number }[];
    expect(bookingRefunds!.n).toBe(0);
  });
});
