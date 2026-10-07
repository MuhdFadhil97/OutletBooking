import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { businesses, businessMembers } from '@outletbooking/db';
import type { Booking, BookingField, BusinessProfile, PublicBusiness, Resource, Service } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

/** E6 booking rules + template settings, and booking questions' hint / show-to-staff. */
const ctx = createTestContext();
let owner = '';
let staff = '';
let staffMemberId = 0;
let court = 0;
let service = 0;
let booking: Booking;

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const patchBiz = (body: object) => ctx.send('PATCH', '/businesses/current', owner, body);

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'rules-a' }))).status).toBe(201);
  owner = await ctx.login('a@example.com', 'password123');
  const [biz] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'rules-a'));
  const staffUserId = await ctx.createUser('Staff Siti', 'siti@example.com');
  const [m] = await ctx.db
    .insert(businessMembers)
    .values({ businessId: biz!.id, userId: staffUserId, role: 'staff', canViewAll: true })
    .returning({ id: businessMembers.id });
  staffMemberId = m!.id;
  staff = await ctx.login('siti@example.com', 'password123');

  court = (await json<Resource>(await ctx.send('POST', '/resources', owner, { name: 'Bay 1', resourceType: 'bay' }), 201)).id;
  const allWeek = { hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '08:00', endTime: '22:00' })) };
  await json(await ctx.send('PUT', `/resources/${court}/working-hours`, owner, allWeek));
  service = (await json<Service>(await ctx.send('POST', '/services', owner, { name: 'Inspection', durationMin: 60, resourceIds: [court] }), 201)).id;
});
afterAll(() => ctx.close());

describe('E6 booking rules', () => {
  it('new businesses get the documented defaults', async () => {
    const biz = await json<BusinessProfile>(await ctx.get('/businesses/current', owner));
    expect(biz).toMatchObject({
      pendingExpiryMin: 15,
      autoConfirmPaid: true,
      customersCanCancel: true,
      lateCancelKeepsDeposit: true,
      settings: {},
    });
  });

  it('owner updates the rules', async () => {
    const biz = await json<BusinessProfile>(
      await patchBiz({ pendingExpiryMin: 30, autoConfirmPaid: false, customersCanCancel: false, lateCancelKeepsDeposit: false }),
    );
    expect(biz).toMatchObject({ pendingExpiryMin: 30, autoConfirmPaid: false, customersCanCancel: false, lateCancelKeepsDeposit: false });
  });

  it('validates ranges and types', async () => {
    expect((await patchBiz({ pendingExpiryMin: 2 })).status).toBe(400);
    expect((await patchBiz({ autoConfirmPaid: 'yes' })).status).toBe(400);
  });

  it('staff cannot change rules, even with "can change setup"', async () => {
    await json(await ctx.send('PATCH', `/staff/${staffMemberId}`, owner, { canEditSetup: true }));
    expect((await ctx.send('PATCH', '/businesses/current', staff, { autoConfirmPaid: true })).status).toBe(403);
    await json(await ctx.send('PATCH', `/staff/${staffMemberId}`, owner, { canEditSetup: false }));
  });
});

describe('template settings', () => {
  it('are shallow-merged, so screens owning different keys keep each other’s values', async () => {
    await json(await patchBiz({ settings: { mobileFeeSen: 3000, serviceArea: 'Klang Valley' } }));
    const biz = await json<BusinessProfile>(await patchBiz({ settings: { serviceArea: 'Puchong', reportPhotos: true } }));
    expect(biz.settings).toEqual({ mobileFeeSen: 3000, serviceArea: 'Puchong', reportPhotos: true });
  });

  it('rejects nested objects and odd keys', async () => {
    expect((await patchBiz({ settings: { nested: { a: 1 } } })).status).toBe(400);
    expect((await patchBiz({ settings: { 'bad key': 1 } })).status).toBe(400);
    expect((await patchBiz({ settings: 'x' })).status).toBe(400);
  });
});

describe('booking questions: hint and show to staff', () => {
  let secret: BookingField;

  beforeAll(async () => {
    await json<BookingField>(
      await ctx.send('POST', '/booking-fields', owner, {
        fieldKey: 'plate',
        label: 'Plate number',
        fieldType: 'text',
        isSearchable: true,
        hint: 'e.g. WXY 1234',
      }),
      201,
    );
    secret = await json<BookingField>(
      await ctx.send('POST', '/booking-fields', owner, {
        fieldKey: 'budget_note',
        label: 'Budget note',
        fieldType: 'text',
        isSearchable: true,
        showToStaff: false,
      }),
      201,
    );
    booking = await json<Booking>(
      await ctx.send('POST', '/bookings', owner, {
        serviceId: service,
        resourceId: court,
        startAt: '2026-11-02T10:00:00+08:00',
        customer: { name: 'Ali', phone: '+60123456789' },
        customFields: { plate: 'WXY 1234', budget_note: 'Max RM800' },
      }),
      201,
    );
  });

  it('stores hint and show-to-staff with documented defaults', async () => {
    const fields = await json<BookingField[]>(await ctx.get('/booking-fields', owner));
    expect(fields.find((f) => f.fieldKey === 'plate')).toMatchObject({ hint: 'e.g. WXY 1234', showToStaff: true });
    expect(secret).toMatchObject({ hint: null, showToStaff: false });
  });

  it('the public page gets the hint', async () => {
    const page = await json<PublicBusiness>(await ctx.get('/public/rules-a'));
    expect(page.bookingFields.find((f) => f.fieldKey === 'plate')).toMatchObject({ hint: 'e.g. WXY 1234' });
  });

  it('owner sees every answer', async () => {
    const b = await json<Booking>(await ctx.get(`/bookings/${booking.id}`, owner));
    expect(b.customFields).toEqual({ plate: 'WXY 1234', budget_note: 'Max RM800' });
  });

  it('staff do not see the hidden question or its answer — in detail, lists or search', async () => {
    const fields = await json<BookingField[]>(await ctx.get('/booking-fields', staff));
    expect(fields.map((f) => f.fieldKey)).not.toContain('budget_note');

    const b = await json<Booking>(await ctx.get(`/bookings/${booking.id}`, staff));
    expect(b.customFields).toEqual({ plate: 'WXY 1234' });
    const day = await json<Booking[]>(await ctx.get('/bookings?from=2026-11-02&to=2026-11-03', staff));
    expect(day.find((x) => x.id === booking.id)!.customFields).not.toHaveProperty('budget_note');

    expect((await json<Booking[]>(await ctx.get('/bookings/search?q=WXY1234', staff))).map((x) => x.id)).toContain(booking.id);
    expect(await json<Booking[]>(await ctx.get('/bookings/search?q=RM800', staff))).toEqual([]);
    expect((await json<Booking[]>(await ctx.get('/bookings/search?q=RM800', owner))).map((x) => x.id)).toContain(booking.id);

    const after = await json<Booking>(await ctx.send('POST', `/bookings/${booking.id}/status`, staff, { status: 'checked_in' }));
    expect(after.customFields).not.toHaveProperty('budget_note');
  });

  it('staff who can change setup see them (they manage the questions)', async () => {
    await json(await ctx.send('PATCH', `/staff/${staffMemberId}`, owner, { canEditSetup: true }));
    const b = await json<Booking>(await ctx.get(`/bookings/${booking.id}`, staff));
    expect(b.customFields).toHaveProperty('budget_note', 'Max RM800');
    expect((await json<BookingField[]>(await ctx.get('/booking-fields', staff))).map((f) => f.fieldKey)).toContain('budget_note');
  });

  it('validates the hint length', async () => {
    const res = await ctx.send('PATCH', `/booking-fields/${secret.id}`, owner, { hint: 'x'.repeat(101) });
    expect(res.status).toBe(400);
  });
});

describe('E5 booking link (slug)', () => {
  it('owner can change it; taken, reserved and invalid slugs are refused', async () => {
    expect((await ctx.post('/signup', signupInput({ email: 'other@example.com', slug: 'rules-other' }))).status).toBe(201);
    const moved = await json<BusinessProfile>(await patchBiz({ slug: 'rules-a-new' }));
    expect(moved.slug).toBe('rules-a-new');
    expect((await ctx.get('/public/rules-a-new')).status).toBe(200);
    expect((await ctx.get('/public/rules-a')).status).toBe(404);

    const taken = await patchBiz({ slug: 'rules-other' });
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { error: { code: string } }).error.code).toBe('slug_taken');
    expect((await patchBiz({ slug: 'admin' })).status).toBe(409);
    expect((await patchBiz({ slug: 'Bad Slug!' })).status).toBe(400);
    await json(await patchBiz({ slug: 'rules-a' }));
  });
});
