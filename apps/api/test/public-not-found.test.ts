import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { businesses, subscriptions } from '@outletbooking/db';
import type { PublicSimilarBusiness } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

const ctx = createTestContext();

const similar = async (slug: string): Promise<string[]> => {
  const res = await ctx.get(`/public/${slug}/similar`);
  expect(res.status).toBe(200);
  return ((await res.json()) as PublicSimilarBusiness[]).map((b) => b.slug);
};

const set = (slug: string, values: Partial<typeof businesses.$inferInsert>) =>
  ctx.db.update(businesses).set(values).where(eq(businesses.slug, slug));

beforeAll(async () => {
  await ctx.reset();
  const slugs = [
    'smash-arena-pj',
    'smash-arena-cheras',
    'smash-arena-klang',
    'smash-arena-ipoh',
    'smash-paused',
    'smash-suspended',
    'smash-closed',
    'smash-ended',
    'green-court',
  ];
  for (const [i, slug] of slugs.entries()) {
    const input = signupInput({ email: `o${i}@example.com`, slug, businessName: slug.replace(/-/g, ' ') });
    expect((await ctx.post('/signup', input)).status).toBe(201);
  }
  await set('smash-arena-pj', { address: '12 Jalan SS2/24, Petaling Jaya' });
  await set('smash-paused', { bookingEnabled: false });
  await set('smash-suspended', { suspendedAt: new Date(), suspendReason: 'Misuse' });
  await set('smash-closed', { closeRequestedAt: new Date() });
  const [ended] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'smash-ended'));
  await ctx.db
    .update(subscriptions)
    .set({ trialEndsAt: new Date(Date.now() - 60_000) })
    .where(eq(subscriptions.businessId, ended!.id));
});
afterAll(() => ctx.close());

describe('F6 · closed booking page', () => {
  it('410 business_closed when the owner asked to close, or the data was deleted', async () => {
    const res = await ctx.get('/public/smash-closed');
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: { code: 'business_closed' } });

    await set('smash-ended', { deletedAt: new Date() });
    try {
      expect((await ctx.get('/public/smash-ended')).status).toBe(410);
      expect((await ctx.get('/public/smash-ended/slots?serviceId=1&date=2030-01-01')).status).toBe(410);
    } finally {
      await set('smash-ended', { deletedAt: null });
    }
  });

  it('a paused page is still 200 (F3), an unknown one 404', async () => {
    expect((await ctx.get('/public/smash-paused')).status).toBe(200);
    expect((await ctx.get('/public/smash-arena')).status).toBe(404);
  });
});

describe('F6 · GET /public/:slug/similar', () => {
  it('suggests up to 3 bookable businesses that start with the typed link, shortest first', async () => {
    expect(await similar('smash-arena')).toEqual(['smash-arena-pj', 'smash-arena-ipoh', 'smash-arena-klang']);
  });

  it('returns only what the page needs', async () => {
    const res = await ctx.get('/public/smash-arena-p/similar');
    const [first] = (await res.json()) as PublicSimilarBusiness[];
    expect(first).toEqual({
      slug: 'smash-arena-pj',
      name: 'smash arena pj',
      template: 'sports',
      address: '12 Jalan SS2/24, Petaling Jaya',
    });
  });

  it('finds typos, also early in the link', async () => {
    expect(await similar('smash-arena-cheraz')).toEqual(['smash-arena-cheras']);
    expect(await similar('smsh-arena-cheras')).toEqual(['smash-arena-cheras']);
    expect(await similar('gren-court')).toEqual(['green-court']);
  });

  it('never suggests paused, suspended, closed or ended businesses', async () => {
    const all = await similar('smash');
    for (const hidden of ['smash-paused', 'smash-suspended', 'smash-closed', 'smash-ended']) {
      expect(await similar(hidden)).not.toContain(hidden);
      expect(all).not.toContain(hidden);
    }
  });

  it('nothing for links that are not close, 400 for invalid ones', async () => {
    expect(await similar('badminton-hub')).toEqual([]);
    expect((await ctx.get('/public/x/similar')).status).toBe(400);
  });
});
