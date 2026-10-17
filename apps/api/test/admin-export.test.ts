import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { adminAuditLog, businesses, businessMembers, platformAdmins, users } from '@outletbooking/db';
import type { DataExportResult, Resource, Service } from '@outletbooking/shared';
import { exportBusinessData } from '../src/services/admin-export';
import { createTestContext, signupInput } from './helpers';

/** I2 · Export data: CSV files of one business, emailed to its owner only. */
const ctx = createTestContext();
const DAY = 86_400_000;

let boss = '';
let nurul = '';
let ownerA = '';
let ownerB = '';
let bizA = 0;
let bizB = 0;
let nurulId = 0;

const json = async <T>(res: Response, status = 200): Promise<T> => {
  expect(res.status).toBe(status);
  return (await res.json()) as T;
};
const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const exportOf = (id: number, cookie = boss, reason = 'Owner asked for a copy (PDPA access request)') =>
  ctx.send('POST', `/admin/businesses/${id}/export`, cookie, { reason });
const exportMail = () => ctx.outbox.filter((m) => m.subject.startsWith('Your OutletBooking data export'));
const file = (m: { attachments?: { filename: string; content: Buffer }[] }, name: string) => m.attachments!.find((a) => a.filename === name)!.content.toString('utf8');
const audit = async () => (await ctx.db.select().from(adminAuditLog).orderBy(adminAuditLog.id)).filter((a) => a.action === 'export_data');

async function makeAdmin(name: string, email: string, role: 'support' | 'super_admin') {
  const id = await ctx.createUser(name, email);
  await ctx.db.insert(platformAdmins).values({ userId: id, role, isActive: true });
  const cookie = await ctx.login(email, 'password123');
  await ctx.db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, id));
  return { id, cookie };
}

/** A court, a service, and one booking for a customer. */
async function fill(owner: string, customerName: string, phone: string) {
  const court = await json<Resource>(await ctx.send('POST', '/resources', owner, { name: 'Court 1', resourceType: 'court' }), 201);
  const allWeek = { hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '00:00', endTime: '23:59' })) };
  await json(await ctx.send('PUT', `/resources/${court.id}/working-hours`, owner, allWeek));
  const service = await json<Service>(await ctx.send('POST', '/services', owner, { name: 'Court hire', durationMin: 60, priceSen: 2000, resourceIds: [court.id] }), 201);
  const start = new Date(Date.now() + 3 * DAY);
  start.setUTCHours(4, 0, 0, 0);
  await json(await ctx.send('POST', '/bookings', owner, { serviceId: service.id, resourceId: court.id, startAt: start.toISOString(), customer: { name: customerName, phone } }), 201);
}

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'exp-a', businessName: 'Smash Arena PJ' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'exp-b', businessName: 'Bengkel Ali' }))).status).toBe(201);
  ownerA = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');
  bizA = (await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'exp-a')))[0]!.id;
  bizB = (await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'exp-b')))[0]!.id;
  await fill(ownerA, '=HYPERLINK("http://evil")', '+60121110001'); // a name that would run as a formula in a spreadsheet
  await fill(ownerB, 'Other Business Customer', '+60129990002');
  ({ cookie: boss } = await makeAdmin('Fadhil Z', 'fadhil@ftech.my', 'super_admin'));
  ({ id: nurulId, cookie: nurul } = await makeAdmin('Nurul A', 'nurul@ftech.my', 'support'));
});

beforeEach(async () => {
  await ctx.db.delete(adminAuditLog);
  ctx.outbox.length = 0;
});

afterAll(() => ctx.close());

describe('export data', () => {
  it('emails the owner (only) six CSV files with the business’s data', async () => {
    const res = await json<DataExportResult>(await exportOf(bizA));
    expect(res.sentTo).toBe('a@example.com');
    expect(res.files.map((f) => f.name)).toEqual(['customers.csv', 'bookings.csv', 'services.csv', 'resources.csv', 'team.csv', 'payments.csv']);
    const mails = exportMail();
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe('a@example.com');
    expect(mails[0]!.attachments!.map((a) => a.filename)).toEqual(res.files.map((f) => f.name));
    expect(mails[0]!.text).toContain('Smash Arena PJ');
  });

  it('has the customer, the booking with a short reference, the service, and nothing from another business', async () => {
    await exportOf(bizA);
    const [mail] = exportMail();
    const customers = file(mail!, 'customers.csv');
    expect(customers.startsWith('﻿')).toBe(true); // BOM: Excel reads accents properly
    expect(customers).toContain('+60121110001');
    const bookings = file(mail!, 'bookings.csv');
    expect(bookings).toMatch(/\r\n[A-F0-9]{6},\d{4}-\d{2}-\d{2},/); // reference, date
    expect(bookings).toContain('Court hire');
    expect(bookings).toContain('Court 1');
    expect(bookings).toContain('20.00'); // RM, not sen
    expect(file(mail!, 'services.csv')).toContain('Court hire');
    expect(file(mail!, 'team.csv')).toContain('a@example.com');
    const all = mail!.attachments!.map((a) => a.content.toString('utf8')).join('\n');
    expect(all).not.toContain('Other Business Customer');
    expect(all).not.toContain('+60129990002');
    expect(all).not.toContain('b@example.com');
  });

  it('is safe to open in a spreadsheet: text that looks like a formula is defused', async () => {
    await exportOf(bizA);
    const customers = file(exportMail()[0]!, 'customers.csv');
    expect(customers).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(customers).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it('carries no secrets or provider data, and the audit log says it happened without the data', async () => {
    await exportOf(bizA);
    const [mail] = exportMail();
    const all = mail!.attachments!.map((a) => a.content.toString('utf8')).join('\n');
    expect(all).not.toMatch(/secret|bill|toyyib|password/i);
    const rows = await audit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ adminUserId: expect.any(Number), businessId: bizA, reason: 'Owner asked for a copy (PDPA access request)' });
    expect(rows[0]!.details).toMatchObject({ customers: 1, bookings: 1, services: expect.any(Number), team: 1 });
    expect(JSON.stringify(rows[0])).not.toMatch(/HYPERLINK|60121110001|a@example/);
  });

  it('every admin role can export; owners and signed-out callers cannot; a reason is required', async () => {
    expect((await exportOf(bizA, nurul)).status).toBe(200);
    expect((await audit())[0]!.adminUserId).toBe(nurulId);
    expect((await exportOf(bizA, ownerA)).status).toBe(403);
    expect((await ctx.post(`/admin/businesses/${bizA}/export`, { reason: 'No session at all' })).status).toBe(401);
    expect((await ctx.send('POST', `/admin/businesses/${bizA}/export`, boss, { reason: 'x' })).status).toBe(400);
    expect((await exportOf(99999)).status).toBe(404);
  });

  it('refuses a business with no active owner, and an email that cannot be sent leaves nothing behind', async () => {
    const [owner] = await ctx.db.select({ id: businessMembers.id }).from(businessMembers).where(eq(businessMembers.businessId, bizB));
    await ctx.db.update(businessMembers).set({ isActive: false }).where(eq(businessMembers.id, owner!.id));
    expect(await errCode(await exportOf(bizB))).toBe('no_owner');
    await ctx.db.update(businessMembers).set({ isActive: true }).where(eq(businessMembers.id, owner!.id));

    const failing = { db: ctx.db, env: ctx.env, mailer: { send: async () => Promise.reject(new Error('Resend is down')) } };
    await expect(exportBusinessData(failing, nurulId, bizA, 'Trying while the mailer is down')).rejects.toMatchObject({ code: 'email_failed' });
    expect(await audit()).toHaveLength(0);
  });
});
