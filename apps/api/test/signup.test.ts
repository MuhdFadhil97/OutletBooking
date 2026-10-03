import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { accounts, businesses, businessMembers, subscriptions, users } from '@outletbooking/db';
import type { MeResponse } from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

const ctx = createTestContext();

beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

describe('POST /signup', () => {
  it('creates user, account, business, owner membership and 7-day trial together', async () => {
    const before = Date.now();
    const res = await ctx.post('/signup', signupInput());
    expect(res.status).toBe(201);

    const [user] = await ctx.db.select().from(users).where(eq(users.email, 'ali@example.com'));
    expect(user).toBeDefined();
    expect(user!.phone).toBe('+60123456789');

    const accs = await ctx.db.select().from(accounts).where(eq(accounts.userId, user!.id));
    expect(accs).toHaveLength(1);
    expect(accs[0]!.providerId).toBe('credential');
    expect(accs[0]!.password).not.toBe('password123'); // hashed

    const [biz] = await ctx.db.select().from(businesses).where(eq(businesses.slug, 'ali-courts'));
    expect(biz).toMatchObject({ name: 'Ali Courts', template: 'sports', resourceLabel: 'Court', slotIntervalMin: 60 });

    const members = await ctx.db.select().from(businessMembers).where(eq(businessMembers.businessId, biz!.id));
    expect(members).toEqual([expect.objectContaining({ userId: user!.id, role: 'owner', isActive: true })]);

    const [sub] = await ctx.db.select().from(subscriptions).where(eq(subscriptions.businessId, biz!.id));
    expect(sub).toMatchObject({ plan: 'trial', status: 'trialing' });
    const days = (sub!.trialEndsAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
  });

  it('lets the new owner log in and GET /me shows 7 trial days left', async () => {
    await ctx.post('/signup', signupInput());
    const cookie = await ctx.login('ali@example.com', 'password123');

    const res = await ctx.get('/me', cookie);
    expect(res.status).toBe(200);
    const me = (await res.json()) as MeResponse;
    expect(me.role).toBe('owner');
    expect(me.business).toMatchObject({ slug: 'ali-courts', name: 'Ali Courts', resourceLabel: 'Court' });
    expect(me.subscription).toMatchObject({ status: 'trialing', trialDaysLeft: 7, isTrialActive: true });
    expect(me.user.email).toBe('ali@example.com');
  });

  it('rolls back the user when the slug is taken (no orphan rows)', async () => {
    await ctx.post('/signup', signupInput());
    const res = await ctx.post('/signup', signupInput({ email: 'siti@example.com', name: 'Siti' }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('slug_taken');

    const orphan = await ctx.db.select().from(users).where(eq(users.email, 'siti@example.com'));
    expect(orphan).toHaveLength(0);
  });

  it('rolls back the business when the email is taken', async () => {
    await ctx.post('/signup', signupInput());
    const res = await ctx.post('/signup', signupInput({ email: 'ALI@example.com', slug: 'other-courts' }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('email_taken');

    const orphan = await ctx.db.select().from(businesses).where(eq(businesses.slug, 'other-courts'));
    expect(orphan).toHaveLength(0);
  });

  it('rejects invalid input with 400', async () => {
    const res = await ctx.post('/signup', signupInput({ phone: '0123456789', slug: 'A!', password: 'short' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details: { fieldErrors: Record<string, unknown> } } };
    expect(body.error.code).toBe('validation_error');
    expect(Object.keys(body.error.details.fieldErrors)).toEqual(expect.arrayContaining(['phone', 'slug', 'password']));
  });

  it("disables Better Auth's own sign-up (must go through /signup)", async () => {
    const res = await ctx.post('/api/auth/sign-up/email', { name: 'X', email: 'x@example.com', password: 'password123' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await ctx.db.select().from(users).where(eq(users.email, 'x@example.com'))).toHaveLength(0);
  });
});

describe('GET /signup/slug-available', () => {
  it('reports available, taken, reserved and invalid slugs', async () => {
    await ctx.post('/signup', signupInput());
    const check = async (slug: string) =>
      (await (await ctx.get(`/signup/slug-available?slug=${encodeURIComponent(slug)}`)).json()) as {
        available: boolean;
        reason?: string;
      };

    expect(await check('new-courts')).toMatchObject({ available: true });
    expect(await check('Ali-Courts')).toMatchObject({ available: false, reason: 'taken' });
    expect(await check('admin')).toMatchObject({ available: false, reason: 'taken' });
    expect(await check('a')).toMatchObject({ available: false, reason: 'invalid' });
  });
});
