import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq, sql as dsql } from 'drizzle-orm';
import {
  adminAuditLog,
  announcements,
  businesses,
  payments,
  plans,
  platformAdmins,
  platformSettings,
  privacyRequests,
  refunds,
  subscriptions,
  twoFactors,
  users,
} from '@outletbooking/db';
import { PLAN_PRICES } from '@outletbooking/shared';
import { createTestContext } from './helpers';

const ctx = createTestContext();
let adminId = 0;
let bizId = 0;
let subscriptionId = 0;

/** Postgres error code of a failed query (drizzle wraps the driver error in `cause`). */
async function pgCode(query: Promise<unknown>): Promise<string | undefined> {
  try {
    await query;
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.cause?.code ?? err.code;
  }
  return undefined;
}

beforeAll(async () => {
  await ctx.reset();
  const [u] = await ctx.db
    .insert(users)
    .values({ name: 'FTech Admin', email: 'admin-schema@ftech.test' })
    .returning({ id: users.id });
  adminId = u!.id;
  const [b] = await ctx.db
    .insert(businesses)
    .values({ slug: 'admin-schema', name: 'Admin Schema' })
    .returning({ id: businesses.id });
  bizId = b!.id;
  const [s] = await ctx.db
    .insert(subscriptions)
    .values({ businessId: bizId })
    .returning({ id: subscriptions.id });
  subscriptionId = s!.id;
});
afterAll(() => ctx.close());

describe('phase 7 schema (schema.sql section 6)', () => {
  it('seeds the default plans to match PLAN_PRICES', async () => {
    const rows = await ctx.db.select().from(plans).orderBy(asc(plans.sortOrder));
    expect(rows.map((p) => [p.code, p.priceSen, p.resourceLimit])).toEqual([
      ['starter', PLAN_PRICES.starter.priceSen, PLAN_PRICES.starter.resourceLimit],
      ['business', PLAN_PRICES.business.priceSen, PLAN_PRICES.business.resourceLimit],
    ]);
    expect(rows[1]!.features).toMatchObject({ staff_app: true, reports: true });
  });

  it('keeps platform_settings to a single row with the defaults', async () => {
    const [row] = await ctx.db.select().from(platformSettings);
    expect(row).toMatchObject({ id: 1, trialDays: 7, graceDays: 3, renewalReminderDays: [7, 3, 1] });
    expect(await pgCode(ctx.db.insert(platformSettings).values({ id: 2 }))).toBe('23514');
    expect(await pgCode(ctx.db.insert(platformSettings).values({}))).toBe('23505');
  });

  it('platform admins default to the support role and reject unknown roles', async () => {
    const [a] = await ctx.db.insert(platformAdmins).values({ userId: adminId }).returning();
    expect(a).toMatchObject({ role: 'support', isActive: true });
    expect(
      await pgCode(ctx.db.update(platformAdmins).set({ role: 'owner' }).where(eq(platformAdmins.id, a!.id))),
    ).toBe('23514');
  });

  it('accepts every new audit action and rejects unknown ones', async () => {
    await ctx.db.insert(adminAuditLog).values([
      { adminUserId: adminId, businessId: bizId, action: 'suspend_business', reason: 'Misuse report' },
      { adminUserId: adminId, action: 'update_plans', reason: 'New prices' },
    ]);
    expect(
      await pgCode(ctx.db.insert(adminAuditLog).values({ adminUserId: adminId, action: 'drop_tables', reason: 'x' })),
    ).toBe('23514');
  });

  it('needs a reason whenever a business is suspended', async () => {
    expect(
      await pgCode(ctx.db.update(businesses).set({ suspendedAt: new Date() }).where(eq(businesses.id, bizId))),
    ).toBe('23514');
    await ctx.db
      .update(businesses)
      .set({ suspendedAt: new Date(), suspendReason: 'Spam bookings' })
      .where(eq(businesses.id, bizId));
  });

  it('allows receipt numbers on plan payments only', async () => {
    const [{ n }] = (await ctx.db.execute(dsql`select nextval('receipt_no_seq')::int as n`)) as unknown as [
      { n: number },
    ];
    const receiptNo = `OB-2026-${String(n).padStart(6, '0')}`;
    const [p] = await ctx.db
      .insert(payments)
      .values({ businessId: bizId, subscriptionId, purpose: 'subscription', amountSen: 4900, receiptNo })
      .returning();
    expect(p!.receiptNo).toBe(receiptNo);
    expect(
      await pgCode(
        ctx.db
          .insert(payments)
          .values({ businessId: bizId, subscriptionId, purpose: 'subscription', amountSen: 4900, receiptNo }),
      ),
    ).toBe('23505');
  });

  it('records a plan refund against a payment without a booking (I24)', async () => {
    const [p] = await ctx.db
      .insert(payments)
      .values({ businessId: bizId, subscriptionId, purpose: 'subscription', amountSen: 9900, status: 'paid' })
      .returning({ id: payments.id });
    const [r] = await ctx.db
      .insert(refunds)
      .values({
        businessId: bizId,
        paymentId: p!.id,
        amountSen: 9900,
        method: 'bank_transfer',
        reasonCode: 'charged_twice',
        bankRef: 'MBB123',
        paidOn: '2026-10-14',
      })
      .returning();
    expect(r).toMatchObject({ bookingId: null, paidOn: '2026-10-14' });
    // Neither a booking nor a payment.
    expect(
      await pgCode(ctx.db.insert(refunds).values({ businessId: bizId, amountSen: 100, method: 'cash' })),
    ).toBe('23514');
    // The payment must belong to the same business.
    const [other] = await ctx.db
      .insert(businesses)
      .values({ slug: 'admin-schema-b', name: 'Other' })
      .returning({ id: businesses.id });
    expect(
      await pgCode(
        ctx.db.insert(refunds).values({ businessId: other!.id, paymentId: p!.id, amountSen: 100, method: 'cash' }),
      ),
    ).toBe('23503');
  });

  it('checks announcement audience and channels', async () => {
    const base = { type: 'maintenance', title: 'Downtime', body: 'Sunday 2am', createdByUserId: adminId };
    await ctx.db.insert(announcements).values({ ...base, audience: 'all', channels: ['email', 'in_app'] });
    expect(
      await pgCode(ctx.db.insert(announcements).values({ ...base, audience: 'plan', channels: ['email'] })),
    ).toBe('23514');
    expect(
      await pgCode(ctx.db.insert(announcements).values({ ...base, audience: 'all', channels: ['sms'] })),
    ).toBe('23514');
    expect(await pgCode(ctx.db.insert(announcements).values({ ...base, audience: 'all', channels: [] }))).toBe(
      '23514',
    );
  });

  it('privacy requests are due in 21 days and need a way to reply', async () => {
    const [r] = await ctx.db
      .insert(privacyRequests)
      .values({ requesterName: 'Ali', requesterEmail: 'ali@example.com', requesterKind: 'customer', kind: 'access' })
      .returning();
    const days = (r!.dueAt.getTime() - r!.receivedAt.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(21);
    expect(
      await pgCode(
        ctx.db.insert(privacyRequests).values({ requesterName: 'Anon', requesterKind: 'visitor', kind: 'other' }),
      ),
    ).toBe('23514');
  });

  it('allows one two-factor row per user and keeps updated_at current', async () => {
    const [t] = await ctx.db
      .insert(twoFactors)
      .values({ userId: adminId, secret: 'enc-secret', backupCodes: 'enc-codes' })
      .returning();
    expect(t).toMatchObject({ verified: true, failedVerificationCount: 0 });
    expect(
      await pgCode(ctx.db.insert(twoFactors).values({ userId: adminId, secret: 's', backupCodes: 'b' })),
    ).toBe('23505');
    await new Promise((r) => setTimeout(r, 10));
    const [u] = await ctx.db
      .update(twoFactors)
      .set({ failedVerificationCount: 1 })
      .where(eq(twoFactors.id, t!.id))
      .returning();
    expect(u!.updatedAt.getTime()).toBeGreaterThan(t!.updatedAt.getTime());
  });
});
