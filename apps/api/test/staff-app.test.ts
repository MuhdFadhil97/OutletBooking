import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { and, eq } from 'drizzle-orm';
import { bookingAttachments, businesses, businessMembers } from '@outletbooking/db';
import type { Booking, BookingAttachment, MySchedule, NotificationPrefs, Resource, Service } from '@outletbooking/shared';
import { staffDaySummary } from '../src/services/daily';
import { wantsPush } from '../src/services/notifications';
import { createTestContext, signupInput, WEB_ORIGIN } from './helpers';

/** Phase 6 staff app: S1/G2 my schedule, S2 result notes + photos, G3 notification switches. */
const ctx = createTestContext();
const TZ = 'Asia/Kuala_Lumpur';
const day = (n: number) => formatInTimeZone(addDays(new Date(), n), TZ, 'yyyy-MM-dd');
const at = (hhmm: string, n = 3) => `${day(n)}T${hhmm}:00+08:00`;

let ownerA = '';
let ownerB = '';
let staffA = '';
let staffNoResource = '';
let bizA = 0;
let staffUserId = 0;
let agent: Resource;
let other: Resource;
let service: Service;
let mine: Booking;
let notMine: Booking;

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const errorOf = async (res: Response) => ({ status: res.status, code: ((await res.json()) as { error: { code: string } }).error.code });
const book = async (resourceId: number, startAt: string) =>
  json<Booking>(
    await ctx.send('POST', '/bookings', ownerA, {
      serviceId: service.id,
      resourceId,
      startAt,
      customer: { name: 'Nurul Huda', phone: '+60123000111' },
    }),
    201,
  );
const schedule = (cookie: string, from = day(0), to = day(7)) => ctx.get(`/me/schedule?from=${from}&to=${to}`, cookie);

/** Multipart upload, the way the app sends a photo. */
function upload(cookie: string, bookingId: number, type = 'image/jpeg', bytes = 2048) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes).fill(1)], { type }), 'photo.jpg');
  return ctx.app.request(`/bookings/${bookingId}/attachments`, { method: 'POST', headers: { origin: WEB_ORIGIN, cookie }, body: form });
}

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'laman', template: 'real_estate' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'other-biz' }))).status).toBe(201);
  ownerA = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');
  const [a] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'laman'));
  bizA = a!.id;

  staffUserId = await ctx.createUser('Aina Ismail', 'aina@example.com');
  const loneUserId = await ctx.createUser('No Resource', 'lone@example.com');
  await ctx.db.insert(businessMembers).values([
    { businessId: bizA, userId: staffUserId, role: 'staff' },
    { businessId: bizA, userId: loneUserId, role: 'staff' },
  ]);
  staffA = await ctx.login('aina@example.com', 'password123');
  staffNoResource = await ctx.login('lone@example.com', 'password123');

  agent = await json<Resource>(await ctx.send('POST', '/resources', ownerA, { name: 'Aina', resourceType: 'staff', userId: staffUserId }), 201);
  other = await json<Resource>(await ctx.send('POST', '/resources', ownerA, { name: 'Kevin', resourceType: 'staff' }), 201);
  const hours = {
    hours: [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({ weekday, startTime: '09:00', endTime: '19:00' })),
  };
  for (const r of [agent, other]) await json(await ctx.send('PUT', `/resources/${r.id}/working-hours`, ownerA, hours));
  service = await json<Service>(
    await ctx.send('POST', '/services', ownerA, {
      name: 'Viewing',
      durationMin: 30,
      travelBufferMin: 30,
      resourceIds: [agent.id, other.id],
    }),
    201,
  );
  mine = await book(agent.id, at('11:00'));
  notMine = await book(other.id, at('11:00'));
});
afterAll(() => ctx.close());

describe('GET /me/schedule (S1 / G2 / G3)', () => {
  it("returns only the bookings, hours and resources linked to the staff member's login", async () => {
    const s = await json<MySchedule>(await schedule(staffA));
    expect(s.timezone).toBe(TZ);
    expect(s.resources).toEqual([{ id: agent.id, name: 'Aina' }]);
    expect(s.bookings.map((b) => b.id)).toEqual([mine.id]);
    expect(s.bookings[0]).toMatchObject({ travelBufferMin: 30, checkedInAt: null, completedAt: null });
    expect(s.hours).toHaveLength(7);
    expect(s.hours[0]).toEqual({ weekday: 0, startTime: '09:00', endTime: '19:00' });
  });

  it('stays "mine" even when the staff member may view all bookings', async () => {
    await ctx.db.update(businessMembers).set({ canViewAll: true }).where(eq(businessMembers.userId, staffUserId));
    const s = await json<MySchedule>(await schedule(staffA));
    expect(s.bookings.map((b) => b.id)).toEqual([mine.id]);
    await ctx.db.update(businessMembers).set({ canViewAll: false }).where(eq(businessMembers.userId, staffUserId));
  });

  it("includes the staff member's days off and whole-business closures, not other people's", async () => {
    for (const resourceId of [agent.id, other.id, null]) {
      await json(
        await ctx.send('POST', '/time-off', ownerA, { resourceId, startAt: at('00:00', 4), endAt: at('23:59', 4), reason: `off ${resourceId}` }),
        201,
      );
    }
    const s = await json<MySchedule>(await schedule(staffA));
    expect(s.timeOff.map((t) => t.reason).sort()).toEqual([`off ${agent.id}`, 'off null']);
  });

  it('a login without a linked resource gets an empty schedule', async () => {
    const s = await json<MySchedule>(await schedule(staffNoResource));
    expect(s).toMatchObject({ resources: [], hours: [], bookings: [] });
  });

  it('rejects ranges longer than 31 days or backwards', async () => {
    expect((await schedule(staffA, day(0), day(40))).status).toBe(400);
    expect((await schedule(staffA, day(3), day(1))).status).toBe(400);
  });

  it('never shows another business', async () => {
    const s = await json<MySchedule>(await schedule(ownerB));
    expect(s.bookings).toEqual([]);
  });
});

describe('PUT /bookings/:id/result (S2 result notes)', () => {
  it('staff add notes to their own booking; empty text clears them', async () => {
    const b = await json<Booking>(await ctx.send('PUT', `/bookings/${mine.id}/result`, staffA, { resultNotes: '  Buyer liked the unit  ' }));
    expect(b.resultNotes).toBe('Buyer liked the unit');
    const cleared = await json<Booking>(await ctx.send('PUT', `/bookings/${mine.id}/result`, staffA, { resultNotes: '' }));
    expect(cleared.resultNotes).toBeNull();
  });

  it("404 for another staff member's booking and for another business", async () => {
    expect((await ctx.send('PUT', `/bookings/${notMine.id}/result`, staffA, { resultNotes: 'x' })).status).toBe(404);
    expect((await ctx.send('PUT', `/bookings/${mine.id}/result`, ownerB, { resultNotes: 'x' })).status).toBe(404);
  });

  it('refuses cancelled bookings', async () => {
    const b = await book(other.id, at('15:00'));
    await json(await ctx.send('POST', `/bookings/${b.id}/status`, ownerA, { status: 'cancelled' }));
    expect(await errorOf(await ctx.send('PUT', `/bookings/${b.id}/result`, ownerA, { resultNotes: 'x' }))).toEqual({
      status: 409,
      code: 'not_editable',
    });
  });

  it('check in and complete still go through the status route (staff, own booking)', async () => {
    const b = await book(agent.id, at('14:00'));
    const checked = await json<Booking>(await ctx.send('POST', `/bookings/${b.id}/status`, staffA, { status: 'checked_in' }));
    expect(checked.checkedInAt).not.toBeNull();
    const done = await json<Booking>(await ctx.send('POST', `/bookings/${b.id}/status`, staffA, { status: 'completed' }));
    expect(done.completedAt).not.toBeNull();
  });
});

describe('/bookings/:id/attachments (S2 photos)', () => {
  let photo: BookingAttachment;

  it('staff upload a photo to their booking; stored under the business prefix', async () => {
    photo = await json<BookingAttachment>(await upload(staffA, mine.id), 201);
    expect(photo).toMatchObject({ contentType: 'image/jpeg', uploadedBy: { id: staffUserId, name: 'Aina Ismail' } });
    const [row] = await ctx.db.select().from(bookingAttachments).where(eq(bookingAttachments.id, photo.id));
    expect(row!.fileKey).toMatch(new RegExp(`^businesses/${bizA}/bookings/${mine.id}/[0-9a-f-]+\\.jpg$`));
    expect(ctx.storage.objects.get(row!.fileKey)?.body.byteLength).toBe(2048);
    expect(photo.url).toContain(row!.fileKey);
  });

  it('lists photos with signed links, for the staff member and the owner', async () => {
    const forStaff = await json<BookingAttachment[]>(await ctx.get(`/bookings/${mine.id}/attachments`, staffA));
    const forOwner = await json<BookingAttachment[]>(await ctx.get(`/bookings/${mine.id}/attachments`, ownerA));
    expect(forStaff.map((p) => p.id)).toEqual([photo.id]);
    expect(forOwner.map((p) => p.id)).toEqual([photo.id]);
  });

  it('rejects other file types, empty or oversize files', async () => {
    expect(await errorOf(await upload(staffA, mine.id, 'application/pdf'))).toEqual({ status: 400, code: 'invalid_file_type' });
    expect(await errorOf(await upload(staffA, mine.id, 'image/png', 0))).toEqual({ status: 400, code: 'file_too_large' });
    expect(await errorOf(await upload(staffA, mine.id, 'image/png', 11 * 1024 * 1024))).toEqual({ status: 400, code: 'file_too_large' });
  });

  it("other staff bookings and other businesses: 404 (tenant isolation)", async () => {
    expect((await upload(staffA, notMine.id)).status).toBe(404);
    expect((await ctx.get(`/bookings/${notMine.id}/attachments`, staffA)).status).toBe(404);
    expect((await upload(ownerB, mine.id)).status).toBe(404);
    expect((await ctx.get(`/bookings/${mine.id}/attachments`, ownerB)).status).toBe(404);
    expect((await ctx.send('DELETE', `/bookings/${mine.id}/attachments/${photo.id}`, ownerB)).status).toBe(404);
  });

  it("staff cannot delete the owner's photo; the owner can delete anyone's", async () => {
    const ownerPhoto = await json<BookingAttachment>(await upload(ownerA, mine.id), 201);
    expect((await ctx.send('DELETE', `/bookings/${mine.id}/attachments/${ownerPhoto.id}`, staffA)).status).toBe(403);
    expect((await ctx.send('DELETE', `/bookings/${mine.id}/attachments/${photo.id}`, ownerA)).status).toBe(204);
    const left = await json<BookingAttachment[]>(await ctx.get(`/bookings/${mine.id}/attachments`, ownerA));
    expect(left.map((p) => p.id)).toEqual([ownerPhoto.id]);
    expect(ctx.storage.objects.size).toBe(1);
  });

  it('a photo id from another booking is not found', async () => {
    const [p] = await ctx.db.select({ id: bookingAttachments.id }).from(bookingAttachments);
    const b = await book(agent.id, at('17:00'));
    expect((await ctx.send('DELETE', `/bookings/${b.id}/attachments/${p!.id}`, ownerA)).status).toBe(404);
  });
});

describe('G3 notification switches', () => {
  it('everything is on until changed; changes merge', async () => {
    expect(await json<NotificationPrefs>(await ctx.get('/me/notification-prefs', staffA))).toEqual({
      newBookings: true,
      changes: true,
      daySummary: true,
    });
    const updated = await json<NotificationPrefs>(await ctx.send('PUT', '/me/notification-prefs', staffA, { daySummary: false }));
    expect(updated).toEqual({ newBookings: true, changes: true, daySummary: false });
    expect((await ctx.send('PUT', '/me/notification-prefs', staffA, {})).status).toBe(400);
  });

  it('a switch that is off stops those pushes; other types still go out', async () => {
    const [owner] = await ctx.db
      .select({ userId: businessMembers.userId })
      .from(businessMembers)
      .where(and(eq(businessMembers.businessId, bizA), eq(businessMembers.role, 'owner')));
    await json(await ctx.send('PUT', '/me/notification-prefs', staffA, { newBookings: false }));
    const both = [owner!.userId, staffUserId];
    expect(await wantsPush(ctx.db, bizA, both, 'booking_new')).toEqual([owner!.userId]);
    expect(await wantsPush(ctx.db, bizA, both, 'booking_cancelled')).toEqual(both);
    expect(await wantsPush(ctx.db, bizA, both, 'staff_joined')).toEqual(both);
  });

  it('the morning day summary skips members who switched it off', async () => {
    expect((await ctx.send('PUT', '/me/push-token', staffA, { token: 'ExponentPushToken[aina]', platform: 'android' })).status).toBe(204);
    expect((await ctx.send('PUT', '/me/push-token', ownerA, { token: 'ExponentPushToken[owner]', platform: 'ios' })).status).toBe(204);
    ctx.pushes.length = 0;
    await staffDaySummary(ctx.db, { send: async (m) => (ctx.pushes.push(...m), m.map(() => ({ status: 'ok' as const, id: 'x' }))) }, new Date(at('06:00')));
    const to = ctx.pushes.map((p) => p.to);
    expect(to).toContain('ExponentPushToken[owner]');
    expect(to).not.toContain('ExponentPushToken[aina]');
  });
});

describe('H6 delete business also removes its photos', () => {
  it('files under the business prefix are deleted', async () => {
    expect(ctx.storage.objects.size).toBeGreaterThan(0);
    const res = await ctx.send('DELETE', '/me', ownerA, { password: 'password123', confirmBusinessName: 'Ali Courts' });
    expect(res.status).toBe(204);
    expect([...ctx.storage.objects.keys()].filter((k) => k.startsWith(`businesses/${bizA}/`))).toEqual([]);
  });
});
