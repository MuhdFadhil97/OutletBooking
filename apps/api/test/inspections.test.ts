import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { eq } from 'drizzle-orm';
import { bookingAttachments, businesses, businessMembers, checklistSections } from '@outletbooking/db';
import {
  STANDARD_CHECKLIST,
  type Booking,
  type Checklist,
  type Inspection,
  type InspectionReportLink,
  type PublicInspectionReport,
  type Resource,
  type Service,
} from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

const ctx = createTestContext();
let ownerA = '';
let ownerB = '';
let staffA = '';
let bizA = 0;
let bay1 = 0;
let prePurchase = 0;

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const at = (hhmm: string, n = 2) =>
  `${formatInTimeZone(addDays(new Date(), n), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd')}T${hhmm}:00+08:00`;
const standardChecks = STANDARD_CHECKLIST.reduce((n, s) => n + s.items.length, 0);

beforeAll(async () => {
  await ctx.reset();
  const vi = { template: 'vehicle_inspection' as const };
  expect((await ctx.post('/signup', signupInput({ ...vi, email: 'a@example.com', slug: 'semak-a', businessName: 'Semak A' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'courts-b', businessName: 'Courts B' }))).status).toBe(201);
  ownerA = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');
  const [a] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'semak-a'));
  bizA = a!.id;

  // Staff Hafiz is linked to Bay 1 and may not change setup.
  const hafiz = await ctx.createUser('Hafiz Rahman', 'hafiz@example.com');
  await ctx.db.insert(businessMembers).values({ businessId: bizA, userId: hafiz, role: 'staff' });
  staffA = await ctx.login('hafiz@example.com', 'password123');

  bay1 = (await json<Resource>(await ctx.send('POST', '/resources', ownerA, { name: 'Bay 1', resourceType: 'bay', userId: hafiz }), 201)).id;
  const allWeek = { hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '08:00', endTime: '20:00' })) };
  await json(await ctx.send('PUT', `/resources/${bay1}/working-hours`, ownerA, allWeek));
  prePurchase = (await json<Service[]>(await ctx.get('/services', ownerA))).find((s) => s.name === 'Pre-purchase inspection')!.id;
  await json(await ctx.send('PATCH', `/services/${prePurchase}`, ownerA, { resourceIds: [bay1] }));
});
afterAll(() => ctx.close());

describe('ST-VI-C checklist', () => {
  it('a new vehicle inspection business starts with the standard checklist; other types have none', async () => {
    const a = await json<Checklist>(await ctx.get('/checklist', ownerA));
    expect(a.sections.map((s) => s.name)).toEqual(STANDARD_CHECKLIST.map((s) => s.name));
    expect(a.checks).toBe(standardChecks);
    expect(await json<Checklist>(await ctx.get('/checklist', ownerB))).toEqual({ sections: [], checks: 0 });
  });

  it('"Use the standard checklist" only when there is none', async () => {
    expect((await json<Checklist>(await ctx.send('POST', '/checklist/standard', ownerB), 201)).checks).toBe(standardChecks);
    const again = await ctx.send('POST', '/checklist/standard', ownerB);
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe('checklist_exists');
  });

  it('owner renames, reorders, adds and removes sections and checks in one save', async () => {
    const current = await json<Checklist>(await ctx.get('/checklist', ownerA));
    const [exterior, engine] = current.sections;
    const saved = await json<Checklist>(
      await ctx.send('PUT', '/checklist', ownerA, {
        sections: [
          { id: engine!.id, name: 'Engine', items: [...engine!.items, { label: 'Turbo' }] },
          { id: exterior!.id, name: exterior!.name, items: exterior!.items.slice(1) }, // drop "Paint & panels"
          { name: 'Documents', items: [{ label: 'Grant matches chassis no.' }] },
        ],
      }),
    );
    expect(saved.sections.map((s) => s.name)).toEqual(['Engine', 'Exterior & body', 'Documents']);
    expect(saved.sections[0]!.items.at(-1)!.label).toBe('Turbo');
    expect(saved.sections[1]!.items.map((i) => i.label)).not.toContain('Paint & panels');
    // Unused removed sections are deleted.
    const rows = await ctx.db.select().from(checklistSections).where(eq(checklistSections.businessId, bizA));
    expect(rows).toHaveLength(3);
  });

  it('staff without "can change setup" can read but not change it; other businesses cannot touch it', async () => {
    expect((await ctx.get('/checklist', staffA)).status).toBe(200);
    expect((await ctx.send('PUT', '/checklist', staffA, { sections: [] })).status).toBe(403);
    const a = await json<Checklist>(await ctx.get('/checklist', ownerA));
    // B cannot rename A's section by id.
    expect((await ctx.send('PUT', '/checklist', ownerB, { sections: [{ id: a.sections[0]!.id, name: 'Hacked', items: [] }] })).status).toBe(404);
    expect((await json<Checklist>(await ctx.get('/checklist', ownerA))).sections[0]!.name).toBe('Engine');
  });
});

describe('S2 inspection result and report', () => {
  let booking: Booking;
  let checklist: Checklist;

  beforeAll(async () => {
    booking = await json<Booking>(
      await ctx.send('POST', '/bookings', ownerA, {
        serviceId: prePurchase,
        resourceId: bay1,
        startAt: at('10:00'),
        customer: { name: 'Seller Tan', phone: '+60123000222' },
        customFields: { plate_number: 'WXY 1234', make_model: 'Honda City' },
      }),
      201,
    );
    checklist = await json<Checklist>(await ctx.get('/checklist', ownerA));
  });

  it('starts empty: every active check without an outcome', async () => {
    const insp = await json<Inspection>(await ctx.get(`/bookings/${booking.id}/inspection`, staffA));
    expect(insp.overall).toBeNull();
    expect(insp.reportWhatsapp).toBe(true);
    expect(insp.sections.flatMap((s) => s.items).every((i) => i.outcome === null)).toBe(true);
  });

  it('the linked inspector saves outcomes per check and the overall result', async () => {
    const [oil, coolant, leaks] = checklist.sections[0]!.items;
    const insp = await json<Inspection>(
      await ctx.send('PUT', `/bookings/${booking.id}/inspection`, staffA, {
        items: [
          { itemId: oil!.id, outcome: 'pass' },
          { itemId: coolant!.id, outcome: 'attention', note: 'Low' },
        ],
      }),
    );
    expect(insp.overall).toBeNull();
    const second = await json<Inspection>(
      await ctx.send('PUT', `/bookings/${booking.id}/inspection`, staffA, {
        overall: 'attention',
        items: [
          { itemId: leaks!.id, outcome: 'fail', note: 'Oil leak at sump' },
          { itemId: oil!.id, outcome: 'pass' },
        ],
      }),
    );
    const engine = second.sections[0]!.items;
    expect(second.overall).toBe('attention');
    expect(engine.slice(0, 3).map((i) => [i.outcome, i.note])).toEqual([
      ['pass', null],
      ['attention', 'Low'],
      ['fail', 'Oil leak at sump'],
    ]);
  });

  it('rejects checks from another business and hides the booking from others', async () => {
    const bChecks = await json<Checklist>(await ctx.get('/checklist', ownerB));
    const res = await ctx.send('PUT', `/bookings/${booking.id}/inspection`, ownerA, {
      items: [{ itemId: bChecks.sections[0]!.items[0]!.id, outcome: 'pass' }],
    });
    expect(res.status).toBe(404);
    expect((await ctx.get(`/bookings/${booking.id}/inspection`, ownerB)).status).toBe(404);
    expect((await ctx.send('PUT', `/bookings/${booking.id}/inspection`, ownerB, { overall: 'pass' })).status).toBe(404);
    expect((await ctx.send('POST', `/bookings/${booking.id}/inspection/report-link`, ownerB)).status).toBe(404);
  });

  it('a check removed later still shows on this booking with its outcome', async () => {
    const [engine, ...rest] = checklist.sections;
    const leaks = engine!.items[2]!;
    await json(
      await ctx.send('PUT', '/checklist', ownerA, {
        sections: [{ id: engine!.id, name: engine!.name, items: engine!.items.filter((i) => i.id !== leaks.id) }, ...rest],
      }),
    );
    expect((await json<Checklist>(await ctx.get('/checklist', ownerA))).sections[0]!.items.map((i) => i.id)).not.toContain(leaks.id);
    const insp = await json<Inspection>(await ctx.get(`/bookings/${booking.id}/inspection`, ownerA));
    expect(insp.sections[0]!.items.find((i) => i.id === leaks.id)).toMatchObject({ outcome: 'fail' });
  });

  it('report link needs an overall result, then the customer sees the report', async () => {
    const other = await json<Booking>(
      await ctx.send('POST', '/bookings', ownerA, {
        serviceId: prePurchase,
        resourceId: bay1,
        startAt: at('14:00'),
        customer: { name: 'Buyer Lim', phone: '+60123000333' },
      }),
      201,
    );
    const noResult = await ctx.send('POST', `/bookings/${other.id}/inspection/report-link`, ownerA);
    expect(noResult.status).toBe(409);
    expect(await errorCode(noResult)).toBe('inspection_incomplete');

    await json(await ctx.send('PUT', `/bookings/${booking.id}/result`, staffA, { resultNotes: 'Minor scratch on rear bumper.' }));
    await ctx.db.insert(bookingAttachments).values({
      businessId: bizA,
      bookingId: booking.id,
      fileKey: `businesses/${bizA}/bookings/${booking.id}/a.jpg`,
      contentType: 'image/jpeg',
    });

    const link = await json<InspectionReportLink>(await ctx.send('POST', `/bookings/${booking.id}/inspection/report-link`, staffA));
    expect(link.reportUrl).toMatch(/\/report\/[0-9a-f]{32}$/);
    const token = link.reportUrl.split('/report/')[1]!;
    expect((await json<Inspection>(await ctx.get(`/bookings/${booking.id}/inspection`, ownerA))).reportSentAt).toBe(link.reportSentAt);

    const report = await json<PublicInspectionReport>(await ctx.get(`/public/bookings/${token}/report`));
    expect(report).toMatchObject({
      business: { name: 'Semak A' },
      serviceName: 'Pre-purchase inspection',
      overall: 'attention',
      notes: 'Minor scratch on rear bumper.',
      counts: { pass: 1, attention: 1, fail: 1, na: 0 },
      inspectorName: 'Hafiz Rahman',
    });
    expect(report.details).toEqual([
      { label: 'Plate number', value: 'WXY 1234' },
      { label: 'Make & model', value: 'Honda City' },
    ]);
    expect(report.sections[0]!.items.map((i) => i.outcome)).toEqual(['pass', 'attention', 'fail']);
    expect(report.photos).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain('Seller Tan'); // no customer name / phone
    expect(JSON.stringify(report)).not.toContain('+60123000222');

    // Report options off: no inspector name, no photos.
    await json(await ctx.send('PATCH', '/businesses/current', ownerA, { settings: { reportPhotos: false, reportInspectorName: false } }));
    const plain = await json<PublicInspectionReport>(await ctx.get(`/public/bookings/${token}/report`));
    expect(plain).toMatchObject({ inspectorName: null, photos: [] });
  });

  it('unknown tokens 404, malformed ones 400', async () => {
    expect((await ctx.get(`/public/bookings/${'0'.repeat(32)}/report`)).status).toBe(404);
    expect((await ctx.get('/public/bookings/not-a-token/report')).status).toBe(400);
  });
});
