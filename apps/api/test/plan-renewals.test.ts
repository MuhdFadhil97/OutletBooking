import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { businesses, notifications, platformSettings, subscriptions } from '@outletbooking/db';
import { graceEnd, hasPlanAccess, type MeResponse, type PublicBusiness } from '@outletbooking/shared';
import { trialReminders } from '../src/services/daily';
import { dueStage, planRenewals, shouldSend, STAGE_ENDED_IN_GRACE, STAGE_PAUSED } from '../src/services/plan-renewals';
import { createTestContext, signupInput } from './helpers';

/** Manual plan renewal (FR-20.7): reminders, grace days, paused notice, and the M5 trial email. */
const ctx = createTestContext();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const sender = { send: async (m: unknown[]) => m.map(() => ({ status: 'ok' as const, id: 'x' })) };

// Malaysia is UTC+8: 01:00Z = 9:00 AM, 13:00Z = 9:00 PM.
const at9am = (isoDay: string) => new Date(`${isoDay}T01:00:00Z`);
const PERIOD_END = new Date('2026-12-06T13:00:00Z'); // 9 PM on 6 Dec, Malaysia time

describe('grace days in hasPlanAccess', () => {
  const end = new Date('2026-12-06T13:00:00Z');
  const sub = (status: string) => ({ status, trialEndsAt: new Date(0), currentPeriodEnd: end });
  it('a paid plan keeps working for the grace days after its end; cancelled and expired do not', () => {
    const during = new Date(end.getTime() + 2 * DAY);
    const after = new Date(end.getTime() + 3 * DAY + HOUR);
    expect(hasPlanAccess(sub('active'), during, 3)).toBe(true);
    expect(hasPlanAccess(sub('past_due'), during, 3)).toBe(true);
    expect(hasPlanAccess(sub('active'), after, 3)).toBe(false);
    expect(hasPlanAccess(sub('active'), during, 0)).toBe(false);
    expect(hasPlanAccess(sub('cancelled'), during, 3)).toBe(false);
    expect(hasPlanAccess(sub('expired'), during, 3)).toBe(false);
    expect(graceEnd(end, 3).getTime()).toBe(end.getTime() + 3 * DAY);
  });
});

describe('which notice is due', () => {
  const days = [7, 3, 1];
  it('picks the smallest reminder day that covers the days left, then ended, then paused', () => {
    expect(dueStage(PERIOD_END, 3, days, at9am('2026-11-25'))).toBeNull(); // 11 days left
    expect(dueStage(PERIOD_END, 3, days, at9am('2026-11-29'))).toBe(7); // 7 days left
    expect(dueStage(PERIOD_END, 3, days, at9am('2026-12-01'))).toBe(7); // 5 days left: first reminder crossed
    expect(dueStage(PERIOD_END, 3, days, at9am('2026-12-03'))).toBe(3);
    expect(dueStage(PERIOD_END, 3, days, at9am('2026-12-05'))).toBe(1);
    expect(dueStage(PERIOD_END, 3, days, at9am('2026-12-06'))).toBe(1); // the day it ends
    expect(dueStage(PERIOD_END, 3, days, at9am('2026-12-07'))).toBe(STAGE_ENDED_IN_GRACE);
    expect(dueStage(PERIOD_END, 3, days, at9am('2026-12-10'))).toBe(STAGE_PAUSED);
    expect(dueStage(PERIOD_END, 0, days, at9am('2026-12-07'))).toBe(STAGE_PAUSED); // no grace days
    expect(dueStage(PERIOD_END, 3, [], at9am('2026-12-05'))).toBeNull(); // reminders switched off
  });
  it('sends only a more urgent notice than the last one for the same period end', () => {
    expect(shouldSend(7, null, null, PERIOD_END)).toBe(true);
    expect(shouldSend(7, PERIOD_END, 7, PERIOD_END)).toBe(false);
    expect(shouldSend(3, PERIOD_END, 7, PERIOD_END)).toBe(true);
    expect(shouldSend(7, PERIOD_END, 3, PERIOD_END)).toBe(false);
    expect(shouldSend(7, new Date(PERIOD_END.getTime() - 30 * DAY), 0, PERIOD_END)).toBe(true); // a new period starts again
    expect(shouldSend(null, null, null, PERIOD_END)).toBe(false);
  });
});

describe('planRenewals job', () => {
  let owner = '';
  let biz = 0;
  const deps = () => ({ db: ctx.db, env: ctx.env, mailer: { send: async (m: Parameters<typeof ctx.outbox.push>[0]) => void ctx.outbox.push(m) }, push: sender });
  const setSub = (values: Partial<typeof subscriptions.$inferInsert>) =>
    ctx.db.update(subscriptions).set(values).where(eq(subscriptions.businessId, biz));
  const sub = async () => (await ctx.db.select().from(subscriptions).where(eq(subscriptions.businessId, biz)))[0]!;
  const rows = (type: string) =>
    ctx.db.select().from(notifications).where(and(eq(notifications.businessId, biz), eq(notifications.type, type as 'plan_grace')));
  const setGrace = (graceDays: number) => ctx.db.update(platformSettings).set({ graceDays }).where(eq(platformSettings.id, 1));

  beforeAll(async () => {
    await ctx.reset();
    expect((await ctx.post('/signup', signupInput({ email: 'a@example.com', slug: 'renew-a' }))).status).toBe(201);
    owner = await ctx.login('a@example.com', 'password123');
    const [a] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'renew-a'));
    biz = a!.id;
  });
  beforeEach(async () => {
    ctx.outbox.length = 0;
    await setGrace(3);
    await setSub({
      plan: 'starter',
      status: 'active',
      currentPeriodStart: new Date(PERIOD_END.getTime() - 30 * DAY),
      currentPeriodEnd: PERIOD_END,
      renewalNoticeFor: null,
      renewalNoticeStage: null,
    });
    await ctx.db.delete(notifications).where(eq(notifications.businessId, biz));
  });
  afterAll(() => setGrace(3));

  it('sends nothing while the plan has more days left than the first reminder', async () => {
    expect(await planRenewals(deps(), at9am('2026-11-25'))).toEqual({ reminders: 0, ended: 0, paused: 0 });
    expect(ctx.outbox).toHaveLength(0);
    expect((await sub()).status).toBe('active');
  });

  it('reminds at 7, 3 and 1 days, once each, by push, in-app row and email', async () => {
    expect((await planRenewals(deps(), at9am('2026-11-29'))).reminders).toBe(1);
    expect((await planRenewals(deps(), at9am('2026-11-29'))).reminders).toBe(0); // same run again: nothing
    expect((await planRenewals(deps(), at9am('2026-11-30'))).reminders).toBe(0); // 6 days left: still the 7-day one
    expect(ctx.outbox).toHaveLength(1);
    expect(ctx.outbox[0]!.to).toBe('a@example.com');
    expect(ctx.outbox[0]!.subject).toBe('Your Starter plan ends in 7 days');
    expect(ctx.outbox[0]!.text).toContain('6 Dec 2026');
    expect(ctx.outbox[0]!.text).toContain('9 Dec 2026'); // the page stays live until the grace days are over
    expect((await rows('plan_renewal_due'))[0]!.title).toBe('Your plan ends in 7 days');

    await planRenewals(deps(), at9am('2026-12-03'));
    await planRenewals(deps(), at9am('2026-12-05'));
    expect(ctx.outbox.map((m) => m.subject)).toEqual([
      'Your Starter plan ends in 7 days',
      'Your Starter plan ends in 3 days',
      'Your Starter plan ends tomorrow',
    ]);
    expect(await rows('plan_renewal_due')).toHaveLength(3);
    expect((await sub()).status).toBe('active');
  });

  it('after the end: "plan ended" while in grace (status past_due), then "paused" (expired)', async () => {
    expect((await planRenewals(deps(), at9am('2026-12-07'))).ended).toBe(1);
    expect((await planRenewals(deps(), at9am('2026-12-08'))).ended).toBe(0);
    expect((await sub()).status).toBe('past_due');
    expect(ctx.outbox.map((m) => m.subject)).toEqual(['Your Starter plan has ended']);
    expect(ctx.outbox[0]!.text).toContain('stays live until 9 Dec 2026');
    expect(await rows('plan_grace')).toHaveLength(1);

    expect((await planRenewals(deps(), at9am('2026-12-10'))).paused).toBe(1);
    expect((await planRenewals(deps(), at9am('2026-12-11'))).paused).toBe(0);
    expect((await sub()).status).toBe('expired');
    expect(ctx.outbox.at(-1)!.subject).toBe('Your booking page is paused');
    expect(await rows('plan_ended')).toHaveLength(1);
  });

  it('with no grace days it goes straight to paused', async () => {
    await setGrace(0);
    expect((await planRenewals(deps(), at9am('2026-12-07'))).paused).toBe(1);
    expect((await sub()).status).toBe('expired');
    expect(await rows('plan_grace')).toHaveLength(0);
  });

  it('a payment (new period end) starts the notices again and is never overwritten by a late job', async () => {
    await planRenewals(deps(), at9am('2026-12-07')); // past_due, grace notice sent
    // Paid: the period moves a month on, status active (what syncPlanPayment writes).
    const next = new Date(PERIOD_END.getTime() + 30 * DAY);
    await setSub({ status: 'active', currentPeriodEnd: next });
    ctx.outbox.length = 0;
    expect((await planRenewals(deps(), at9am('2026-12-08'))).ended).toBe(0);
    expect((await sub()).status).toBe('active');
    expect(ctx.outbox).toHaveLength(0);
    // Next period's reminders work again from nothing.
    expect((await planRenewals(deps(), at9am('2027-01-02'))).reminders).toBe(1);
    expect(ctx.outbox[0]!.subject).toBe('Your Starter plan ends in 3 days');
  });

  it('leaves trials, cancelled and open-ended plans alone', async () => {
    await setSub({ status: 'trialing', plan: 'trial', currentPeriodEnd: null });
    expect(await planRenewals(deps(), at9am('2026-12-10'))).toEqual({ reminders: 0, ended: 0, paused: 0 });
    await setSub({ status: 'cancelled', plan: 'starter', currentPeriodEnd: PERIOD_END });
    expect(await planRenewals(deps(), at9am('2026-12-10'))).toEqual({ reminders: 0, ended: 0, paused: 0 });
    await setSub({ status: 'active', plan: 'starter', currentPeriodEnd: null });
    expect(await planRenewals(deps(), at9am('2026-12-10'))).toEqual({ reminders: 0, ended: 0, paused: 0 });
    expect(ctx.outbox).toHaveLength(0);
  });

  it('keeps the booking page and app open through the grace days, then pauses them', async () => {
    const now = Date.now();
    await setSub({ status: 'active', currentPeriodEnd: new Date(now - 2 * DAY) });
    const me = async () => ((await (await ctx.get('/me', owner)).json()) as MeResponse).subscription.hasAccess;
    const page = async () => ((await (await ctx.get('/public/renew-a')).json()) as PublicBusiness).bookingEnabled;
    expect(await me()).toBe(true);
    expect(await page()).toBe(true);
    await setSub({ status: 'past_due', currentPeriodEnd: new Date(now - 4 * DAY) });
    expect(await me()).toBe(false);
    expect(await page()).toBe(false);
    await setGrace(7);
    expect(await me()).toBe(true); // changing the setting applies at once
    expect(await page()).toBe(true);
  });
});

describe('M5 trial ending email', () => {
  let biz = 0;
  beforeAll(async () => {
    await ctx.reset();
    expect((await ctx.post('/signup', signupInput({ email: 'trial@example.com', slug: 'renew-trial', businessName: 'Trial Courts' }))).status).toBe(201);
    const [a] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, 'renew-trial'));
    biz = a!.id;
  });

  it('is emailed once with the push on day 5, and once when the trial ends', async () => {
    // Sign-up also sends its confirmation email in the background, so only look at the trial emails.
    const sent: Parameters<typeof ctx.outbox.push>[0][] = [];
    const mailer = { send: async (m: Parameters<typeof ctx.outbox.push>[0]) => void sent.push(m) };
    const [s] = await ctx.db.select().from(subscriptions).where(eq(subscriptions.businessId, biz));
    const mail = { mailer, env: ctx.env };
    const soon = new Date(s!.trialEndsAt.getTime() - 36 * HOUR);
    await trialReminders(ctx.db, sender, soon, mail);
    await trialReminders(ctx.db, sender, soon, mail);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('trial@example.com');
    expect(sent[0]!.subject).toMatch(/^Your free trial ends /);
    expect(sent[0]!.text).toContain('Choose a plan');

    await trialReminders(ctx.db, sender, new Date(s!.trialEndsAt.getTime() + HOUR), mail);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.subject).toBe('Your free trial has ended');
    expect(sent[1]!.text).toContain('paused');
  });

  it('still works without mail (push only) and does not stop when the mailer fails', async () => {
    await ctx.db.delete(notifications).where(eq(notifications.businessId, biz));
    const [s] = await ctx.db.select().from(subscriptions).where(eq(subscriptions.businessId, biz));
    const failing = { send: async () => Promise.reject(new Error('Resend is down')) };
    expect(await trialReminders(ctx.db, sender, new Date(s!.trialEndsAt.getTime() - 36 * HOUR), { mailer: failing, env: ctx.env })).toBe(1);
    expect(await ctx.db.select().from(notifications).where(and(eq(notifications.businessId, biz), eq(notifications.type, 'trial_ending')))).toHaveLength(1);
  });
});

afterAll(() => ctx.close());
