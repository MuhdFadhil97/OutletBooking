import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { hashPassword } from 'better-auth/crypto';
import { accounts, users } from '@outletbooking/db';
import type { MeResponse } from '@outletbooking/shared';
import { errorHandler } from '../src/middleware/error-handler';
import { requirePermission, requireRole } from '../src/middleware/tenant';
import type { AppEnv } from '../src/types';
import { createTestContext, signupInput } from './helpers';

const ctx = createTestContext();
let cookieA = '';

beforeAll(async () => {
  await ctx.reset();
  const a = await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'business-a', businessName: 'Business A' }));
  const b = await ctx.post('/signup', signupInput({ email: 'b@example.com', slug: 'business-b', businessName: 'Business B' }));
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  cookieA = await ctx.login('a@example.com', 'password123');
});
afterAll(() => ctx.close());

describe('tenant isolation', () => {
  it('user A cannot read business B by slug (404, not 403 — no existence leak)', async () => {
    const res = await ctx.get('/businesses/business-b', cookieA);
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain('Business B');
  });

  it('user A can read their own business by slug', async () => {
    const res = await ctx.get('/businesses/business-a', cookieA);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ slug: 'business-a', name: 'Business A' });
  });

  it('ignores a business id supplied by the client', async () => {
    // B was created second, so its integer id is 2.
    const res = await ctx.get('/businesses/current?business_id=2&businessId=2', cookieA, {
      'x-business-id': '2',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ slug: 'business-a' });

    const me = (await (await ctx.get('/me?business_id=2', cookieA, { 'x-business-id': '2' })).json()) as MeResponse;
    expect(me.business.slug).toBe('business-a');
  });

  it('never returns integer ids to the client', async () => {
    const body = (await (await ctx.get('/businesses/current', cookieA)).json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('id');
  });

  it('requires a session (401)', async () => {
    expect((await ctx.get('/me')).status).toBe(401);
    expect((await ctx.get('/businesses/current')).status).toBe(401);
    expect((await ctx.get('/businesses/current', 'better-auth.session_token=forged')).status).toBe(401);
  });

  it('a logged-in user with no membership gets 403', async () => {
    // Orphan user (e.g. invited staff who has not been linked yet)
    const [u] = await ctx.db
      .insert(users)
      .values({ name: 'Loner', email: 'loner@example.com' })
      .returning({ id: users.id });
    await ctx.db
      .insert(accounts)
      .values({ userId: u!.id, accountId: String(u!.id), providerId: 'credential', password: await hashPassword('password123') });

    const cookie = await ctx.login('loner@example.com', 'password123');
    const res = await ctx.get('/me', cookie);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('no_business');
  });
});

describe('requireRole', () => {
  const app = new Hono<AppEnv>()
    .use(async (c, next) => {
      c.set('tenant', {
        businessId: 1,
        memberId: 1,
        role: c.req.header('x-role') as 'owner' | 'staff',
        canViewAll: false,
        canTakePayments: c.req.header('x-pay') === '1',
        canEditSetup: false,
        planActive: true,
      });
      await next();
    })
    .get('/owner-only', requireRole('owner'), (c) => c.text('ok'))
    .get('/payments', requirePermission('canTakePayments'), (c) => c.text('ok'));
  app.onError(errorHandler);

  it('blocks staff from owner-only routes', async () => {
    expect((await app.request('/owner-only', { headers: { 'x-role': 'staff' } })).status).toBe(403);
    expect((await app.request('/owner-only', { headers: { 'x-role': 'owner' } })).status).toBe(200);
  });

  it('requirePermission checks the resolved flag', async () => {
    expect((await app.request('/payments', { headers: { 'x-role': 'staff' } })).status).toBe(403);
    expect((await app.request('/payments', { headers: { 'x-role': 'staff', 'x-pay': '1' } })).status).toBe(200);
  });
});
