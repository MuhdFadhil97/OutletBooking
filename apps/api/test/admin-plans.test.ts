import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { adminAuditLog, businesses, platformAdmins, plans, platformSettings, subscriptions, users } from '@outletbooking/db';
import {
  DEFAULT_PLANS,
  recommendedPlan,
  type AdminPlanCatalog,
  type PlanInfo,
  type PublicPlans,
  type UpdatePlansInput,
} from '@outletbooking/shared';
import { createTestContext, signupInput } from './helpers';

/** I12 · Plans & prices: super admins edit what the website, the app, sign-up and plan assignment use. */
const ctx = createTestContext();

let superCookie = '';
let supportCookie = '';
let ownerCookie = '';
let bizId = 0;

const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const adminPlans = async () => (await (await ctx.get('/admin/plans', superCookie)).json()) as AdminPlanCatalog;
const publicPlans = async () => {
  const res = await ctx.get('/plans');
  expect(res.status).toBe(200);
  return (await res.json()) as PublicPlans;
};
const audit = (action: string) =>
  ctx.db
    .select()
    .from(adminAuditLog)
    .where(eq(adminAuditLog.action, action as typeof adminAuditLog.$inferSelect.action))
    .orderBy(adminAuditLog.id);

/** The current catalog as a save payload, with changes applied. */
async function payload(
  edit: (p: UpdatePlansInput) => void = () => undefined,
  reason = 'Launch pricing',
): Promise<UpdatePlansInput> {
  const c = await adminPlans();
  const body: UpdatePlansInput = {
    plans: c.plans.map(({ code, priceSen, resourceLimit, extraResourceSen, features, isPublic }) => ({
      code,
      priceSen,
      resourceLimit,
      extraResourceSen,
      features: { ...features },
      isPublic,
    })),
    settings: { ...c.settings },
    reason,
  };
  edit(body);
  return body;
}
const save = (body: unknown) => ctx.send('POST', '/admin/plans', superCookie, body);

async function restoreDefaults() {
  for (const p of DEFAULT_PLANS) {
    await ctx.db
      .update(plans)
      .set({ priceSen: p.priceSen, resourceLimit: p.resourceLimit, extraResourceSen: p.extraResourceSen, features: p.features, isPublic: true })
      .where(eq(plans.code, p.code));
  }
  await ctx.db.update(platformSettings).set({ trialDays: 7, graceDays: 3, renewalReminderDays: [7, 3, 1] }).where(eq(platformSettings.id, 1));
}

async function makeAdmin(name: string, email: string, role: 'support' | 'super_admin') {
  const id = await ctx.createUser(name, email);
  await ctx.db.insert(platformAdmins).values({ userId: id, role });
  const cookie = await ctx.login(email, 'password123');
  await ctx.db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, id));
  return cookie;
}

beforeAll(async () => {
  await ctx.reset();
  superCookie = await makeAdmin('Fadhil Z', 'fadhil@ftech.my', 'super_admin');
  supportCookie = await makeAdmin('Nurul A', 'nurul@ftech.my', 'support');
  expect((await ctx.post('/signup', signupInput({ email: 'owner@example.com', slug: 'plans-biz' }))).status).toBe(201);
  ownerCookie = await ctx.login('owner@example.com', 'password123');
  bizId = (await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'plans-biz')))[0]!.id;
});

beforeEach(async () => {
  await restoreDefaults();
  await ctx.db.delete(adminAuditLog);
});

afterAll(async () => {
  await restoreDefaults();
  await ctx.close();
});

describe('GET /plans (public)', () => {
  it('shows price, limits, features and trial length — nothing about any business', async () => {
    const res = await ctx.get('/plans');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=60');
    const body = (await res.json()) as PublicPlans;
    expect(body).toEqual({
      plans: DEFAULT_PLANS,
      trialDays: 7,
    });
  });

  it('hides a plan switched off for the website', async () => {
    expect((await save(await payload((p) => (p.plans[0]!.isPublic = false)))).status).toBe(200);
    expect((await publicPlans()).plans.map((p) => p.code)).toEqual(['business']);
  });
});

describe('access', () => {
  it('only super admins read or save plans', async () => {
    for (const cookie of [supportCookie, ownerCookie]) {
      expect((await ctx.get('/admin/plans', cookie)).status).toBe(403);
      expect((await ctx.send('POST', '/admin/plans', cookie, await payload())).status).toBe(403);
    }
    expect((await ctx.get('/admin/plans')).status).toBe(401);
    const res = await ctx.get('/admin/plans', supportCookie);
    expect(await errCode(res)).toBe('super_admin_only');
  });

  it('reads the catalog with how many businesses are on each plan', async () => {
    await ctx.db.update(subscriptions).set({ plan: 'starter', status: 'active' }).where(eq(subscriptions.businessId, bizId));
    const c = await adminPlans();
    expect(c.plans.map((p) => [p.code, p.priceSen, p.resourceLimit])).toEqual([
      ['starter', 4900, 3],
      ['business', 9900, 10],
    ]);
    expect(c.settings).toEqual({ trialDays: 7, graceDays: 3, renewalReminderDays: [7, 3, 1] });
    expect(c.businessesByPlan).toEqual({ starter: 1, business: 0 });
    await ctx.db.update(subscriptions).set({ plan: 'trial', status: 'trialing' }).where(eq(subscriptions.businessId, bizId));
  });
});

describe('save', () => {
  it('changes price and limit, trial length and reminders; audit rows with before → after and the reason', async () => {
    const res = await save(
      await payload((p) => {
        p.plans[0]!.priceSen = 5900;
        p.plans[0]!.resourceLimit = 5;
        p.plans[1]!.features.reports = false;
        p.settings.trialDays = 14;
        p.settings.renewalReminderDays = [3, 7, 7, 1];
      }),
    );
    expect(res.status).toBe(200);
    const saved = (await res.json()) as AdminPlanCatalog;
    expect(saved.plans[0]).toMatchObject({ code: 'starter', priceSen: 5900, resourceLimit: 5 });
    expect(saved.plans[1]!.features.reports).toBe(false);
    expect(saved.settings).toEqual({ trialDays: 14, graceDays: 3, renewalReminderDays: [7, 3, 1] });

    expect((await audit('update_plans')).map((a) => [a.reason, a.businessId, a.details])).toEqual([
      ['Launch pricing', null, { plan: 'starter', changes: 'price RM 49 → RM 59; resources 3 → 5' }],
      ['Launch pricing', null, { plan: 'business', changes: 'reports off' }],
    ]);
    expect((await audit('update_platform_settings')).map((a) => a.details)).toEqual([{ changes: 'trial 7 → 14 days' }]);
  });

  it('the website, the app and sign-up use the new values', async () => {
    await save(
      await payload((p) => {
        p.plans[0]!.priceSen = 5950;
        p.settings.trialDays = 14;
      }),
    );
    const pub = await publicPlans();
    expect(pub.plans[0]).toMatchObject({ code: 'starter', priceSen: 5950 });
    expect(pub.trialDays).toBe(14);

    const info = (await (await ctx.get('/businesses/current/plan', ownerCookie)).json()) as PlanInfo;
    expect(info.plans[0]).toMatchObject({ code: 'starter', priceSen: 5950 });

    const before = Date.now();
    expect((await ctx.post('/signup', signupInput({ email: 'late@example.com', slug: 'plans-late' }))).status).toBe(201);
    const [late] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'plans-late'));
    const [sub] = await ctx.db.select().from(subscriptions).where(eq(subscriptions.businessId, late!.id));
    const days = (sub!.trialEndsAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(13.99);
    expect(days).toBeLessThan(14.01);
  });

  it('existing subscriptions keep their limit; a plan change picks up the new one', async () => {
    await ctx.db
      .update(subscriptions)
      .set({ plan: 'starter', status: 'active', currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000), resourceLimit: 3 })
      .where(eq(subscriptions.businessId, bizId));
    await save(await payload((p) => (p.plans[1]!.resourceLimit = 25)));
    const [kept] = await ctx.db.select().from(subscriptions).where(eq(subscriptions.businessId, bizId));
    expect(kept!.resourceLimit).toBe(3);

    const res = await ctx.send('POST', `/admin/businesses/${bizId}/change-plan`, superCookie, { plan: 'business', reason: 'Upgrade' });
    expect(res.status).toBe(200);
    const [changed] = await ctx.db.select().from(subscriptions).where(eq(subscriptions.businessId, bizId));
    expect(changed!.resourceLimit).toBe(25);
    await ctx.db
      .update(subscriptions)
      .set({ plan: 'trial', status: 'trialing', currentPeriodEnd: null, resourceLimit: 10 })
      .where(eq(subscriptions.businessId, bizId));
  });

  it('"Best for you" follows the Starter limit', async () => {
    await save(await payload((p) => (p.plans[0]!.resourceLimit = 1)));
    const info = (await (await ctx.get('/businesses/current/plan', ownerCookie)).json()) as PlanInfo;
    expect(info.plans[0]!.resourceLimit).toBe(1);
    // Same business, same usage: only the limit changed, so the recommendation is computed against it.
    expect(recommendedPlan(2, 0, 1)).toBe('business');
    expect(recommendedPlan(2, 0, info.plans[0]!.resourceLimit)).toBe('business');
    expect(recommendedPlan(2, 0)).toBe('starter');
  });

  it('refuses a save with nothing changed, and writes no audit row', async () => {
    const res = await save(await payload());
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe('no_change');
    expect(await ctx.db.select().from(adminAuditLog)).toHaveLength(0);
  });

  it('validates: reason, price, limits, trial and grace days, reminders, both plans, one public plan', async () => {
    const bad = async (edit: (p: UpdatePlansInput) => void, reason?: string) =>
      (await save(await payload(edit, reason))).status;
    expect(await bad(() => undefined, 'ab')).toBe(400);
    expect(await bad((p) => (p.plans[0]!.priceSen = 0))).toBe(400);
    expect(await bad((p) => (p.plans[0]!.priceSen = 49.5))).toBe(400);
    expect(await bad((p) => (p.plans[0]!.resourceLimit = 0))).toBe(400);
    expect(await bad((p) => (p.settings.trialDays = 0))).toBe(400);
    expect(await bad((p) => (p.settings.trialDays = 91))).toBe(400);
    expect(await bad((p) => (p.settings.graceDays = 31))).toBe(400);
    expect(await bad((p) => (p.settings.renewalReminderDays = [0]))).toBe(400);
    expect(await bad((p) => (p.settings.renewalReminderDays = [1, 2, 3, 4, 5, 6]))).toBe(400);
    expect(await bad((p) => p.plans.pop())).toBe(400);
    expect(await bad((p) => (p.plans[1]!.code = 'starter'))).toBe(400);
    expect(
      await bad((p) => {
        p.plans[0]!.isPublic = false;
        p.plans[1]!.isPublic = false;
      }),
    ).toBe(400);
    expect((await publicPlans()).plans).toHaveLength(2);
    expect(await ctx.db.select().from(adminAuditLog)).toHaveLength(0);
  });

  it('the I9 audit log lists plan changes with no business', async () => {
    await save(await payload((p) => (p.plans[1]!.priceSen = 8900)));
    const log = (await (await ctx.get('/admin/audit-log?action=update_plans', superCookie)).json()) as {
      business: unknown;
      details: { changes: string };
    }[];
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ business: null, details: { changes: 'price RM 99 → RM 89' } });
  });
});
