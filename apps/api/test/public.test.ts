import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PublicBusiness, Service } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

const ctx = createTestContext();
let ownerA = '';
let ownerB = '';

const json = async <T>(res: Response, status = 200): Promise<T> => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};

beforeAll(async () => {
  await ctx.reset();
  expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'arena-a', businessName: 'Arena A' }))).status).toBe(201);
  expect((await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'arena-b', businessName: 'Arena B' }))).status).toBe(201);
  ownerA = await ctx.login('a@example.com', 'password123');
  ownerB = await ctx.login('b@example.com', 'password123');
});
afterAll(() => ctx.close());

describe('GET /public/:slug', () => {
  it('returns the business and its visible services without logging in', async () => {
    const shown = await json<Service>(
      await ctx.send('POST', '/services', ownerA, { name: 'Court hire', durationMin: 60, priceSen: 4000 }),
      201,
    );
    const hidden = await json<Service>(
      await ctx.send('POST', '/services', ownerA, { name: 'Members only', durationMin: 60, isVisible: false }),
      201,
    );
    const deleted = await json<Service>(await ctx.send('POST', '/services', ownerA, { name: 'Old', durationMin: 30 }), 201);
    expect((await ctx.send('DELETE', `/services/${deleted.id}`, ownerA)).status).toBe(204);

    const biz = await json<PublicBusiness>(await ctx.get('/public/arena-a'));
    expect(biz).toMatchObject({ slug: 'arena-a', name: 'Arena A', timezone: 'Asia/Kuala_Lumpur', bookingEnabled: true });
    const ids = biz.services.map((s) => s.id);
    expect(ids).toContain(shown.id);
    expect(ids).not.toContain(hidden.id);
    expect(ids).not.toContain(deleted.id);
    expect(biz.services.find((s) => s.id === shown.id)).toEqual({
      id: shown.id,
      name: 'Court hire',
      description: null,
      durationMin: 60,
      durationOptions: null,
      priceUnit: 'per_booking',
      priceSen: 4000,
      depositSen: 0,
      prepayFull: false,
      locationType: 'at_business',
    });
  });

  it('only shows that business, and no internal fields', async () => {
    const bServices = await json<Service[]>(await ctx.get('/services', ownerB));
    const a = await json<PublicBusiness>(await ctx.get('/public/arena-a'));
    expect(a.services.map((s) => s.id)).not.toEqual(expect.arrayContaining(bServices.map((s) => s.id)));
    expect(Object.keys(a)).not.toContain('id');
    expect(Object.keys(a.services[0]!)).not.toContain('bufferMin');
  });

  it('matches the slug case-insensitively', async () => {
    expect((await json<PublicBusiness>(await ctx.get('/public/Arena-A'))).slug).toBe('arena-a');
  });

  it('404 for an unknown slug, 400 for an invalid one', async () => {
    expect((await ctx.get('/public/no-such-biz')).status).toBe(404);
    expect((await ctx.get('/public/x')).status).toBe(400);
  });
});
