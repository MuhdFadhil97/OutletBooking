import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { eq } from 'drizzle-orm';
import { pushTokens } from '@outletbooking/db';
import type {
  Booking,
  NotificationList,
  PublicAvailability,
  PublicBookingConfirmation,
  Resource,
  Service,
  StaffInvitation,
} from '@outletbooking/shared';
import { createPushSender } from '../src/services/push';
import { createTestContext, signupInput } from './helpers';

/** D6 · in-app notifications + push tokens. */
const ctx = createTestContext();
let owner = '';
let ownerB = '';
let staff = '';
let court1 = 0;
let court2 = 0;
let service = 0;
let n = 0;

const TZ = 'Asia/Kuala_Lumpur';
const day = (d: number) => formatInTimeZone(addDays(new Date(), d), TZ, 'yyyy-MM-dd');
const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};
const list = async (cookie: string) => json<NotificationList>(await ctx.get('/notifications', cookie));
const token = (name: string) => `ExponentPushToken[${name}]`;

async function webBooking(resourceId: number, d = 2, name = 'Lee Wei') {
  const slots = await json<PublicAvailability>(
    await ctx.get(`/public/nt-a/slots?serviceId=${service}&date=${day(d)}&resourceId=${resourceId}`),
  );
  const slot = slots.slots[n++ % slots.slots.length]!;
  return json<PublicBookingConfirmation>(
    await ctx.post('/public/nt-a/bookings', {
      serviceId: service,
      resourceId,
      startAt: slot.startAt,
      customer: { name, phone: `+6019888${String(n).padStart(4, '0')}` },
    }),
    201,
  );
}

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'nt-a', name: 'Aina Owner' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'nt-b' }))).status).toBe(201);
  owner = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');
  court1 = (await json<Resource>(await ctx.send('POST', '/resources', owner, { name: 'Court 1', resourceType: 'court' }), 201)).id;
  court2 = (await json<Resource>(await ctx.send('POST', '/resources', owner, { name: 'Court 2', resourceType: 'court' }), 201)).id;
  for (const id of [court1, court2]) {
    await json(
      await ctx.send('PUT', `/resources/${id}/working-hours`, owner, {
        hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '08:00', endTime: '22:00' })),
      }),
    );
  }
  service = (
    await json<Service>(
      await ctx.send('POST', '/services', owner, { name: 'Court hire', durationMin: 60, priceSen: 0, resourceIds: [court1, court2] }),
      201,
    )
  ).id;
});
afterAll(() => ctx.close());

describe('staff joined', () => {
  it('the owner hears when an invite is accepted', async () => {
    const inv = await json<StaffInvitation>(
      await ctx.send('POST', '/staff/invitations', owner, { email: 'siti@example.com', resourceId: court1 }),
      201,
    );
    const tok = inv.inviteUrl.split('/invite/')[1]!;
    await json(await ctx.post(`/invitations/${tok}/accept`, { name: 'Siti Aminah', phone: '+60111222333', password: 'password123' }));
    staff = await ctx.login('siti@example.com', 'password123');

    const mine = await list(owner);
    expect(mine.unread).toBe(1);
    expect(mine.items[0]).toMatchObject({ type: 'staff_joined', title: 'Siti Aminah joined your team', read: false, bookingId: null });
    expect((await list(staff)).items).toEqual([]);
  });
});

describe('booking notifications', () => {
  it('web booking: owner and the staff linked to that resource', async () => {
    const before = { owner: (await list(owner)).unread, staff: (await list(staff)).unread };
    await webBooking(court1, 2, 'Lee Wei');
    const o = await list(owner);
    const s = await list(staff);
    expect(o.unread).toBe(before.owner + 1);
    expect(s.unread).toBe(before.staff + 1);
    expect(s.items[0]).toMatchObject({ type: 'booking_new', title: 'New booking' });
    expect(s.items[0]!.body).toMatch(/^Lee Wei · Court 1 · \w{3} \d{1,2} \w{3}, /);
    expect(s.items[0]!.bookingId).toEqual(expect.any(Number));
  });

  it('a booking on another resource does not reach that staff member', async () => {
    const before = (await list(staff)).unread;
    await webBooking(court2, 3);
    expect((await list(staff)).unread).toBe(before);
  });

  it('customer cancel → "Cancelled by customer"', async () => {
    const booked = await webBooking(court1, 4, 'Kevin Lim');
    await json(await ctx.post(`/public/bookings/${booked.token}/cancel`, {}));
    const s = await list(staff);
    expect(s.items[0]).toMatchObject({ type: 'booking_cancelled', title: 'Cancelled by customer' });
    expect(s.items[0]!.body).toContain('Kevin Lim');
  });

  it('walk-in by the owner: staff hear, the owner (who did it) does not', async () => {
    const ownerBefore = (await list(owner)).unread;
    const slots = await json<PublicAvailability>(await ctx.get(`/public/nt-a/slots?serviceId=${service}&date=${day(5)}&resourceId=${court1}`));
    const b = await json<Booking>(
      await ctx.send('POST', '/bookings', owner, {
        serviceId: service,
        resourceId: court1,
        startAt: slots.slots[0]!.startAt,
        customer: { name: 'Walk-in', phone: '+60120000001' },
        source: 'walk_in',
      }),
      201,
    );
    expect((await list(owner)).unread).toBe(ownerBefore);
    const s = await list(staff);
    expect(s.items[0]).toMatchObject({ type: 'walk_in', title: 'Walk-in added by Aina Owner', bookingId: b.id });
    expect(s.items[0]!.body).toContain('RM 0');

    await json(await ctx.send('POST', `/bookings/${b.id}/cancel`, owner, {}));
    expect((await list(staff)).items[0]).toMatchObject({ type: 'booking_cancelled', title: 'Booking cancelled by Aina Owner' });
    expect((await list(owner)).unread).toBe(ownerBefore);
  });
});

describe('read state', () => {
  it('mark one, then all', async () => {
    const { items } = await list(staff);
    const first = items.find((i) => !i.read)!;
    expect((await ctx.send('POST', `/notifications/${first.id}/read`, staff)).status).toBe(204);
    const after = await list(staff);
    expect(after.items.find((i) => i.id === first.id)!.read).toBe(true);
    expect(after.unread).toBe(items.filter((i) => !i.read).length - 1);

    expect((await ctx.send('POST', '/notifications/read-all', staff)).status).toBe(204);
    expect((await list(staff)).unread).toBe(0);
  });

  it("someone else's notification is 404 — across users and businesses", async () => {
    const ownerItem = (await list(owner)).items[0]!;
    expect((await ctx.send('POST', `/notifications/${ownerItem.id}/read`, staff)).status).toBe(404);
    expect((await ctx.send('POST', `/notifications/${ownerItem.id}/read`, ownerB)).status).toBe(404);
    expect((await list(ownerB)).items).toEqual([]);
    expect((await list(owner)).items.find((i) => i.id === ownerItem.id)!.read).toBe(false);
  });

  it('needs a login', async () => {
    expect((await ctx.get('/notifications')).status).toBe(401);
  });
});

describe('push', () => {
  it('saves a token, pushes to it after the change, drops tokens Expo reports dead', async () => {
    expect((await ctx.send('POST', '/push-tokens', staff, { token: 'nope', platform: 'ios' })).status).toBe(400);
    expect((await ctx.send('POST', '/push-tokens', staff, { token: token('staffPhone'), platform: 'ios' })).status).toBe(204);
    expect((await ctx.send('POST', '/push-tokens', staff, { token: token('Dead1'), platform: 'android' })).status).toBe(204);
    ctx.pushed.length = 0;

    const booked = await webBooking(court1, 6, 'Nur Aisyah');
    await vi.waitFor(() => expect(ctx.pushed.map((m) => m.to).sort()).toEqual([token('Dead1'), token('staffPhone')]));
    expect(ctx.pushed[0]).toMatchObject({ title: 'New booking', data: { type: 'booking_new', bookingId: expect.any(Number) } });
    expect(booked.status).toBe('confirmed');
    await vi.waitFor(async () => {
      const rows = await ctx.db.select({ token: pushTokens.token }).from(pushTokens);
      expect(rows.map((r) => r.token)).toEqual([token('staffPhone')]);
    });
  });

  it('a token moves to whoever logs in on the device; log out removes it', async () => {
    expect((await ctx.send('POST', '/push-tokens', owner, { token: token('staffPhone'), platform: 'ios' })).status).toBe(204);
    const [row] = await ctx.db.select().from(pushTokens).where(eq(pushTokens.token, token('staffPhone')));
    const ownerId = (await json<{ user: { id: number } }>(await ctx.get('/me', owner))).user.id;
    expect(row!.userId).toBe(ownerId);
    // Someone else can't remove it.
    expect((await ctx.send('DELETE', '/push-tokens', staff, { token: token('staffPhone') })).status).toBe(204);
    expect(await ctx.db.select().from(pushTokens)).toHaveLength(1);
    expect((await ctx.send('DELETE', '/push-tokens', owner, { token: token('staffPhone') })).status).toBe(204);
    expect(await ctx.db.select().from(pushTokens)).toHaveLength(0);
  });

  it('Expo sender: batches, reports DeviceNotRegistered, off in tests', async () => {
    const calls: unknown[][] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { to: string }[];
      calls.push(body);
      return new Response(
        JSON.stringify({
          data: body.map((m) =>
            m.to.includes('Gone') ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' },
          ),
        }),
      );
    }) as typeof fetch;
    const sender = createPushSender({ NODE_ENV: 'production', PUSH_TRANSPORT: 'expo' }, fetchFn);
    const msgs = Array.from({ length: 150 }, (_, i) => ({ to: token(i === 120 ? 'Gone' : `d${i}`), title: 'Hi' }));
    expect(await sender.send(msgs)).toEqual({ deadTokens: [token('Gone')] });
    expect(calls.map((c) => c.length)).toEqual([100, 50]);
    expect(await createPushSender({ NODE_ENV: 'test' }, fetchFn).send(msgs)).toEqual({ deadTokens: [] });
    expect(calls).toHaveLength(2);
  });
});
