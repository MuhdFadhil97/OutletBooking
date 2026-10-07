import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { businesses, businessMembers, subscriptions } from '@outletbooking/db';
import type { BookingField, BusinessProfile, Resource, Service, TimeOff, WorkingHour } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

const ctx = createTestContext();
let ownerA = '';
let ownerB = '';
let staffA = '';
let bizA = 0;
let staffUserId = 0;

/** B's rows, used to prove A cannot reach them. */
const b = { serviceId: 0, resourceId: 0, timeOffId: 0, fieldId: 0 };

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'setup-a' }))).status).toBe(201);
  expect(
    (await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'setup-b', template: 'vehicle_inspection' })))
      .status,
  ).toBe(201);
  ownerA = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');

  const [a] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'setup-a'));
  bizA = a!.id;
  staffUserId = await ctx.createUser('Staff Siti', 'siti@example.com');
  await ctx.db.insert(businessMembers).values({ businessId: bizA, userId: staffUserId, role: 'staff' });
  staffA = await ctx.login('siti@example.com', 'password123');

  // Rows in business B
  b.serviceId = (await json<Service[]>(await ctx.get('/services', ownerB)))[0]!.id;
  b.resourceId = (
    await json<Resource>(await ctx.send('POST', '/resources', ownerB, { name: 'Bay 1', resourceType: 'bay' }), 201)
  ).id;
  b.timeOffId = (
    await json<TimeOff>(
      await ctx.send('POST', '/time-off', ownerB, {
        resourceId: null,
        startAt: '2026-12-25T00:00:00+08:00',
        endAt: '2026-12-26T00:00:00+08:00',
        reason: 'Christmas',
      }),
      201,
    )
  ).id;
  b.fieldId = (await json<BookingField[]>(await ctx.get('/booking-fields', ownerB)))[0]!.id;
});
afterAll(() => ctx.close());

describe('business profile', () => {
  it('owner updates profile and booking settings', async () => {
    const res = await ctx.send('PATCH', '/businesses/current', ownerA, {
      name: 'Ali Courts PJ',
      whatsappPhone: '+60129876543',
      address: 'Jalan SS2/24, Petaling Jaya',
      resourceLabel: 'Court',
      minAdvanceMin: 120,
      maxDaysAhead: 14,
      email: '',
    });
    const body = await json<BusinessProfile>(res);
    expect(body).toMatchObject({ name: 'Ali Courts PJ', resourceLabel: 'Court', minAdvanceMin: 120, email: null });
    expect(body).not.toHaveProperty('id');
  });

  it('rejects invalid phone and ignores template (business type is fixed; the booking link is editable, see E5)', async () => {
    expect((await ctx.send('PATCH', '/businesses/current', ownerA, { whatsappPhone: '0123' })).status).toBe(400);
    const res = await ctx.send('PATCH', '/businesses/current', ownerA, { template: 'clinic' });
    expect(await json<BusinessProfile>(res)).toMatchObject({ slug: 'setup-a', template: 'sports' });
  });

  it('staff cannot edit the profile', async () => {
    expect((await ctx.send('PATCH', '/businesses/current', staffA, { name: 'Nope' })).status).toBe(403);
  });
});

describe('resources + services', () => {
  let court1: Resource;
  let court2: Resource;
  let service: Service;

  it('creates resources', async () => {
    court1 = await json<Resource>(
      await ctx.send('POST', '/resources', ownerA, { name: 'Court 1', resourceType: 'court', color: '#1E88E5' }),
      201,
    );
    court2 = await json<Resource>(await ctx.send('POST', '/resources', ownerA, { name: 'Court 2', resourceType: 'court' }), 201);
    expect(court1).toMatchObject({ name: 'Court 1', resourceType: 'court', linkedUser: null, serviceIds: [] });
    expect((await ctx.send('POST', '/resources', ownerA, { name: 'X', resourceType: 'spaceship' })).status).toBe(400);
  });

  it('creates a service with duration options, peak rules and resources', async () => {
    service = await json<Service>(
      await ctx.send('POST', '/services', ownerA, {
        name: 'Badminton',
        durationMin: 60,
        durationOptions: [180, 60, 120],
        priceUnit: 'per_block',
        priceSen: 2000,
        prepayFull: true,
        priceRules: [{ name: 'Peak', weekday: 6, startTime: '08:00', endTime: '23:00', priceSen: 3000 }],
        resourceIds: [court1.id, court2.id],
      }),
      201,
    );
    expect(service).toMatchObject({
      durationOptions: [60, 120, 180],
      priceRules: [{ weekday: 6, startTime: '08:00', endTime: '23:00', priceSen: 3000 }],
      resourceIds: [court1.id, court2.id],
    });
    const r = await json<Resource>(await ctx.get(`/resources/${court1.id}`, ownerA));
    expect(r.serviceIds).toContain(service.id);
  });

  it('validates services', async () => {
    const bad = (body: object) => ctx.send('POST', '/services', ownerA, { name: 'X', durationMin: 60, ...body });
    expect((await bad({ durationOptions: [90] })).status).toBe(400); // not a multiple of 60
    expect((await bad({ priceSen: 1000, depositSen: 2000 })).status).toBe(400);
    expect((await bad({ priceRules: [{ weekday: 1, startTime: '18:00', endTime: '09:00', priceSen: 1 }] })).status).toBe(400);
    expect((await bad({ priceSen: 10.5 })).status).toBe(400); // money is integer sen
  });

  it('PATCH changes only what was sent and re-validates against stored values', async () => {
    const updated = await json<Service>(
      await ctx.send('PATCH', `/services/${service.id}`, ownerA, { priceSen: 2500, resourceIds: [court2.id] }),
    );
    expect(updated).toMatchObject({ priceSen: 2500, prepayFull: true, durationOptions: [60, 120, 180] });
    expect(updated.resourceIds).toEqual([court2.id]);
    expect(updated.priceRules).toHaveLength(1); // untouched

    // durationMin 45 conflicts with stored options [60,120,180]
    expect((await ctx.send('PATCH', `/services/${service.id}`, ownerA, { durationMin: 45 })).status).toBe(400);
  });

  it('archives a service (soft delete)', async () => {
    const tmp = await json<Service>(await ctx.send('POST', '/services', ownerA, { name: 'Temp', durationMin: 30 }), 201);
    expect((await ctx.send('DELETE', `/services/${tmp.id}`, ownerA)).status).toBe(204);
    const list = await json<Service[]>(await ctx.get('/services', ownerA));
    expect(list.map((s) => s.id)).not.toContain(tmp.id);
    expect((await ctx.get(`/services/${tmp.id}`, ownerA)).status).toBe(404);
  });

  it('links a resource to a staff member of the same business only', async () => {
    const linked = await json<Resource>(
      await ctx.send('PATCH', `/resources/${court1.id}`, ownerA, { userId: staffUserId }),
    );
    expect(linked.linkedUser).toMatchObject({ name: 'Staff Siti', email: 'siti@example.com' });

    const outsider = await ctx.createUser('Outsider', 'outsider@example.com');
    expect((await ctx.send('PATCH', `/resources/${court2.id}`, ownerA, { userId: outsider })).status).toBe(404);
  });

  it('staff only see their linked resources and cannot write', async () => {
    const list = await json<Resource[]>(await ctx.get('/resources', staffA));
    expect(list.map((r) => r.id)).toEqual([court1.id]);
    expect((await ctx.get(`/resources/${court2.id}`, staffA)).status).toBe(404);
    expect((await ctx.send('POST', '/resources', staffA, { name: 'Sneaky', resourceType: 'court' })).status).toBe(403);
    expect((await ctx.send('POST', '/services', staffA, { name: 'Sneaky', durationMin: 30 })).status).toBe(403);
    expect((await ctx.get('/services', staffA)).status).toBe(200);
  });

  it('enforces the plan resource limit', async () => {
    await ctx.db.update(subscriptions).set({ resourceLimit: 2 }).where(eq(subscriptions.businessId, bizA));
    const res = await ctx.send('POST', '/resources', ownerA, { name: 'Court 3', resourceType: 'court' });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('resource_limit');

    // Archiving frees a slot
    const tmp = court2;
    expect((await ctx.send('DELETE', `/resources/${tmp.id}`, ownerA)).status).toBe(204);
    const again = await ctx.send('POST', '/resources', ownerA, { name: 'Court 3', resourceType: 'court' });
    expect(again.status).toBe(201);
    court2 = await json<Resource>(again, 201);
    await ctx.db.update(subscriptions).set({ resourceLimit: 10 }).where(eq(subscriptions.businessId, bizA));
  });

  describe('working hours', () => {
    const week = [
      { weekday: 1, startTime: '09:00', endTime: '13:00' },
      { weekday: 1, startTime: '14:00', endTime: '22:00' }, // lunch break
      { weekday: 6, startTime: '08:00', endTime: '24:00' }, // until midnight
    ];

    it('replaces the weekly schedule (multiple ranges per day)', async () => {
      const res = await ctx.send('PUT', `/resources/${court1.id}/working-hours`, ownerA, { hours: week });
      const hours = await json<WorkingHour[]>(res);
      expect(hours.map(({ id: _id, ...h }) => h)).toEqual(week);

      const replaced = await json<WorkingHour[]>(
        await ctx.send('PUT', `/resources/${court1.id}/working-hours`, ownerA, { hours: week.slice(2) }),
      );
      expect(replaced).toHaveLength(1);
    });

    it('rejects overlapping ranges and bad times', async () => {
      const overlap = [
        { weekday: 2, startTime: '09:00', endTime: '13:00' },
        { weekday: 2, startTime: '12:00', endTime: '18:00' },
      ];
      expect((await ctx.send('PUT', `/resources/${court1.id}/working-hours`, ownerA, { hours: overlap })).status).toBe(400);
      const bad = [{ weekday: 2, startTime: '25:00', endTime: '26:00' }];
      expect((await ctx.send('PUT', `/resources/${court1.id}/working-hours`, ownerA, { hours: bad })).status).toBe(400);
    });

    it('copies hours to other resources', async () => {
      await ctx.send('PUT', `/resources/${court1.id}/working-hours`, ownerA, { hours: week });
      const res = await ctx.send('POST', `/resources/${court1.id}/working-hours/copy`, ownerA, {
        toResourceIds: [court2.id],
      });
      expect(res.status).toBe(204);
      const copied = await json<WorkingHour[]>(await ctx.get(`/resources/${court2.id}/working-hours`, ownerA));
      expect(copied).toHaveLength(3);
    });

    it('staff can read hours of their own resource only', async () => {
      expect((await ctx.get(`/resources/${court1.id}/working-hours`, staffA)).status).toBe(200);
      expect((await ctx.get(`/resources/${court2.id}/working-hours`, staffA)).status).toBe(404);
      expect((await ctx.send('PUT', `/resources/${court1.id}/working-hours`, staffA, { hours: [] })).status).toBe(403);
    });
  });

  describe('time off', () => {
    it('creates resource and whole-business time off and lists by range', async () => {
      await json<TimeOff>(
        await ctx.send('POST', '/time-off', ownerA, {
          resourceId: court1.id,
          startAt: '2026-11-02T09:00:00+08:00',
          endAt: '2026-11-02T13:00:00+08:00',
          reason: 'Resurfacing',
        }),
        201,
      );
      const holiday = await json<TimeOff>(
        await ctx.send('POST', '/time-off', ownerA, {
          resourceId: null,
          startAt: '2026-10-20T00:00:00+08:00',
          endAt: '2026-10-21T00:00:00+08:00',
          reason: 'Deepavali',
        }),
        201,
      );
      expect(holiday.startAt).toBe('2026-10-19T16:00:00.000Z'); // stored as UTC

      const nov = await json<TimeOff[]>(
        await ctx.get(`/time-off?from=${encodeURIComponent('2026-11-01T00:00:00+08:00')}`, ownerA),
      );
      expect(nov.map((t) => t.reason)).toEqual(['Resurfacing']);

      const forCourt2 = await json<TimeOff[]>(await ctx.get(`/time-off?resourceId=${court2.id}`, ownerA));
      expect(forCourt2.map((t) => t.reason)).toEqual(['Deepavali']); // closures apply to all
    });

    it('rejects end before start, also when patching one side', async () => {
      const bad = await ctx.send('POST', '/time-off', ownerA, {
        resourceId: null,
        startAt: '2026-10-21T00:00:00+08:00',
        endAt: '2026-10-20T00:00:00+08:00',
      });
      expect(bad.status).toBe(400);
      const [t] = await json<TimeOff[]>(await ctx.get('/time-off', ownerA));
      expect((await ctx.send('PATCH', `/time-off/${t!.id}`, ownerA, { endAt: '2020-01-01T00:00:00Z' })).status).toBe(400);
    });

    it('is owner-only', async () => {
      expect((await ctx.get('/time-off', staffA)).status).toBe(403);
    });
  });
});

describe('booking fields', () => {
  it('lists template fields (sports: number of players)', async () => {
    const list = await json<BookingField[]>(await ctx.get('/booking-fields', ownerA));
    expect(list.map((f) => f.fieldKey)).toContain('players');
  });

  it('creates, rejects duplicate keys and enforces select options', async () => {
    const field = await json<BookingField>(
      await ctx.send('POST', '/booking-fields', ownerA, {
        fieldKey: 'team_name',
        label: 'Team name',
        fieldType: 'text',
        options: ['ignored', 'for text'],
      }),
      201,
    );
    expect(field.options).toBeNull();

    const dup = await ctx.send('POST', '/booking-fields', ownerA, { fieldKey: 'team_name', label: 'X', fieldType: 'text' });
    expect(dup.status).toBe(409);
    expect(await errorCode(dup)).toBe('field_key_taken');

    const noOpts = await ctx.send('POST', '/booking-fields', ownerA, { fieldKey: 'level', label: 'Level', fieldType: 'select' });
    expect(noOpts.status).toBe(400);

    // Switching an existing text field to select without options is rejected too
    expect((await ctx.send('PATCH', `/booking-fields/${field.id}`, ownerA, { fieldType: 'select' })).status).toBe(400);
    const sel = await json<BookingField>(
      await ctx.send('PATCH', `/booking-fields/${field.id}`, ownerA, {
        fieldType: 'select',
        options: ['Beginner', 'Pro'],
      }),
    );
    expect(sel.options).toEqual(['Beginner', 'Pro']);
  });

  it('reorders and deletes', async () => {
    const list = await json<BookingField[]>(await ctx.get('/booking-fields', ownerA));
    const reversed = list.map((f) => f.id).reverse();
    const after = await json<BookingField[]>(await ctx.send('PUT', '/booking-fields/order', ownerA, { ids: reversed }));
    expect(after.map((f) => f.id)).toEqual(reversed);

    expect((await ctx.send('DELETE', `/booking-fields/${reversed[0]}`, ownerA)).status).toBe(204);
    expect(await json<BookingField[]>(await ctx.get('/booking-fields', ownerA))).toHaveLength(list.length - 1);
  });

  it('staff can read but not write', async () => {
    expect((await ctx.get('/booking-fields', staffA)).status).toBe(200);
    expect(
      (await ctx.send('POST', '/booking-fields', staffA, { fieldKey: 'x_y', label: 'X', fieldType: 'text' })).status,
    ).toBe(403);
  });
});

describe('tenant isolation (setup routes)', () => {
  it("A gets 404 on every one of B's rows", async () => {
    const paths = [
      ['GET', `/services/${b.serviceId}`],
      ['PATCH', `/services/${b.serviceId}`],
      ['DELETE', `/services/${b.serviceId}`],
      ['GET', `/resources/${b.resourceId}`],
      ['PATCH', `/resources/${b.resourceId}`],
      ['DELETE', `/resources/${b.resourceId}`],
      ['GET', `/resources/${b.resourceId}/working-hours`],
      ['PATCH', `/time-off/${b.timeOffId}`],
      ['DELETE', `/time-off/${b.timeOffId}`],
      ['PATCH', `/booking-fields/${b.fieldId}`],
      ['DELETE', `/booking-fields/${b.fieldId}`],
    ] as const;
    for (const [method, path] of paths) {
      const res =
        method === 'GET' ? await ctx.get(path, ownerA) : await ctx.send(method, path, ownerA, method === 'PATCH' ? { name: 'x', label: 'x', reason: 'x' } : undefined);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    const put = await ctx.send('PUT', `/resources/${b.resourceId}/working-hours`, ownerA, { hours: [] });
    expect(put.status).toBe(404);
  });

  it("A cannot attach B's rows to its own", async () => {
    const svc = await ctx.send('POST', '/services', ownerA, { name: 'X', durationMin: 30, resourceIds: [b.resourceId] });
    expect(svc.status).toBe(404);
    const res = await ctx.send('POST', '/resources', ownerA, { name: 'X', resourceType: 'court', serviceIds: [b.serviceId] });
    expect(res.status).toBe(404);
    const off = await ctx.send('POST', '/time-off', ownerA, {
      resourceId: b.resourceId,
      startAt: '2026-11-01T00:00:00Z',
      endAt: '2026-11-02T00:00:00Z',
    });
    expect(off.status).toBe(404);
    const fld = await ctx.send('POST', '/booking-fields', ownerA, {
      serviceId: b.serviceId,
      fieldKey: 'x_y',
      label: 'X',
      fieldType: 'text',
    });
    expect(fld.status).toBe(404);
    const reorder = await ctx.send('PUT', '/booking-fields/order', ownerA, { ids: [b.fieldId] });
    expect(reorder.status).toBe(404);
  });

  it("lists never include B's rows and B's data is unchanged", async () => {
    const services = await json<Service[]>(await ctx.get('/services', ownerA));
    expect(services.map((s) => s.id)).not.toContain(b.serviceId);
    const timeOff = await json<TimeOff[]>(await ctx.get('/time-off', ownerA));
    expect(timeOff.map((t) => t.reason)).not.toContain('Christmas');

    const bServices = await json<Service[]>(await ctx.get('/services', ownerB));
    expect(bServices.map((s) => s.id)).toContain(b.serviceId);
  });
});
