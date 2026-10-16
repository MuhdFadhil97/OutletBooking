import { randomBytes } from 'node:crypto';
import { addDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { and, desc, eq, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  adminAuditLog,
  billingDetails,
  businesses,
  businessMembers,
  payments,
  refunds,
  subscriptions,
  users,
  type Db,
} from '@outletbooking/db';
import {
  PLAN_PAYMENT_CHECK_AFTER_MINUTES,
  PLAN_PAYMENT_ERRORS,
  PLAN_PAYMENTS_EXPORT_MAX_ROWS,
  PLAN_RENEW_SOON_DAYS,
  type PlanPaymentKpis,
  type PlanPaymentRow,
  type PlanPaymentRowStatus,
  type PlanPaymentsQuery,
  type PlanPaymentsResponse,
  type RecordBankTransferInput,
  type RecordBankTransferResult,
} from '@outletbooking/shared';
import type { Env } from '../env';
import { AppError, notFound } from '../errors';
import { csvCell } from './admin';
import { applyPaidMonth, sendReceiptEmail, type PlanReceiptSnapshot } from './billing';
import { periodText, refundEmail } from './billing-emails';
import type { Mailer } from './mailer';
import { getPlanCatalog } from './plan-catalog';

/** I8 · Plan payments (FTech's own money only; booking payments are never read here). */

export const TZ = 'Asia/Kuala_Lumpur';
const PAGE_SIZE = 50;
export const MINUTE_MS = 60_000;

/** A Date inside a raw `sql` template must be sent as text. */
export const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

export const isPlanPayment = eq(payments.purpose, 'subscription');

export const selectRows = (db: Db, where: SQL | undefined, limit: number) =>
  db
    .select({
      id: payments.id,
      ref: payments.billCode,
      businessId: businesses.id,
      businessName: businesses.name,
      provider: payments.provider,
      method: payments.method,
      status: payments.status,
      amountSen: payments.amountSen,
      transactionRef: payments.transactionRef,
      receiptNo: payments.receiptNo,
      snapshot: payments.receiptSnapshot,
      paidAt: payments.paidAt,
      createdAt: payments.createdAt,
      recordedBy: sql<string | null>`(select u.name from ${users} u where u.id = ${payments.recordedByUserId})`,
    })
    .from(payments)
    .innerJoin(businesses, eq(businesses.id, payments.businessId))
    .where(and(isPlanPayment, where))
    .orderBy(desc(payments.id))
    .limit(limit);

export type Selected = Awaited<ReturnType<typeof selectRows>>[number];

export function rowStatus(r: Selected, now: Date): PlanPaymentRowStatus {
  switch (r.status) {
    case 'paid':
      return 'paid';
    case 'refunded':
      return 'refunded';
    case 'failed':
    case 'expired':
      return 'not_completed';
    default:
      return now.getTime() - r.createdAt.getTime() >= PLAN_PAYMENT_CHECK_AFTER_MINUTES * MINUTE_MS ? 'to_check' : 'waiting';
  }
}

export function toRow(r: Selected, now: Date): PlanPaymentRow {
  const snap = (r.snapshot ?? {}) as PlanReceiptSnapshot;
  return {
    id: r.id,
    ref: r.ref ?? '',
    businessId: r.businessId,
    businessName: r.businessName,
    plan: snap.plan ?? null,
    planName: snap.planName ?? null,
    amountSen: r.amountSen,
    method: r.method,
    manual: r.provider === 'manual',
    recordedBy: r.recordedBy,
    providerRef: r.provider === 'manual' ? r.transactionRef : r.ref,
    status: rowStatus(r, now),
    receiptNo: r.receiptNo,
    at: (r.paidAt ?? r.createdAt).toISOString(),
  };
}

function filterWhere(query: Pick<PlanPaymentsQuery, 'q' | 'filter'>, now: Date): SQL | undefined {
  const parts: SQL[] = [];
  const needle = query.q?.trim();
  if (needle) {
    const like = `%${needle.replace(/[%_\\]/g, '\\$&')}%`;
    parts.push(
      or(
        ilike(businesses.name, like),
        ilike(businesses.slug, like),
        ilike(payments.receiptNo, like),
        ilike(payments.billCode, like),
        ilike(payments.transactionRef, like),
      )!,
    );
  }
  switch (query.filter) {
    case 'paid':
      parts.push(inArray(payments.status, ['paid', 'refunded']));
      break;
    case 'not_completed':
      parts.push(inArray(payments.status, ['failed', 'expired']));
      break;
    case 'to_check':
      parts.push(eq(payments.status, 'pending'), lt(payments.createdAt, new Date(now.getTime() - PLAN_PAYMENT_CHECK_AFTER_MINUTES * MINUTE_MS)));
      break;
    case 'renew_soon':
      // The latest paid payment of a paying business whose month ends within the next 7 days.
      parts.push(
        eq(payments.status, 'paid'),
        sql`${payments.id} = (select max(p2.id) from ${payments} p2 where p2.business_id = ${payments.businessId}
          and p2.purpose = 'subscription' and p2.status = 'paid')`,
        sql`exists (select 1 from ${subscriptions} s where s.business_id = ${payments.businessId} and s.status = 'active'
          and s.current_period_end > ${ts(now)} and s.current_period_end <= ${ts(addDays(now, PLAN_RENEW_SOON_DAYS))})`,
      );
      break;
    case 'all':
      break;
  }
  return parts.length ? and(...parts) : undefined;
}

/** Start of the calendar month (Malaysia time) `monthsBack` months ago, as an instant. */
const monthStart = (now: Date, monthsBack: number) => {
  const local = toZonedTime(now, TZ);
  return fromZonedTime(new Date(local.getFullYear(), local.getMonth() - monthsBack, 1), TZ);
};

async function kpis(db: Db, now: Date): Promise<PlanPaymentKpis> {
  const thisStart = monthStart(now, 0);
  const lastStart = monthStart(now, 1);
  // Same stretch of last month as has passed this month, so early in the month is not compared with a whole month.
  const lastSameEnd = new Date(lastStart.getTime() + (now.getTime() - thisStart.getTime()));
  const checkBefore = new Date(now.getTime() - PLAN_PAYMENT_CHECK_AFTER_MINUTES * MINUTE_MS);
  const [row] = await db
    .select({
      // Money received; money paid back is taken off below, in the month the refund was recorded.
      thisMonth: sql<number>`coalesce(sum(${payments.amountSen}) filter (where ${payments.status} in ('paid','refunded') and ${payments.paidAt} >= ${ts(thisStart)}), 0)::int`,
      lastMonth: sql<number>`coalesce(sum(${payments.amountSen}) filter (where ${payments.status} in ('paid','refunded') and ${payments.paidAt} >= ${ts(lastStart)} and ${payments.paidAt} < ${ts(lastSameEnd)}), 0)::int`,
      notCompleted: sql<number>`count(*) filter (where ${payments.status} in ('failed','expired') and ${payments.createdAt} >= ${ts(addDays(now, -30))})::int`,
      toCheck: sql<number>`count(*) filter (where ${payments.status} = 'pending' and ${payments.createdAt} < ${ts(checkBefore)})::int`,
    })
    .from(payments)
    .where(isPlanPayment);
  // Refunds of plan payments (booking_id is null for these; a business's own booking refunds are not FTech's money).
  const [back] = await db
    .select({
      thisMonth: sql<number>`coalesce(sum(${refunds.amountSen}) filter (where ${refunds.createdAt} >= ${ts(thisStart)}), 0)::int`,
      lastMonth: sql<number>`coalesce(sum(${refunds.amountSen}) filter (where ${refunds.createdAt} >= ${ts(lastStart)} and ${refunds.createdAt} < ${ts(lastSameEnd)}), 0)::int`,
    })
    .from(refunds)
    .where(and(isNull(refunds.bookingId), isNotNull(refunds.paymentId)));
  const [renew] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(subscriptions)
    .innerJoin(businesses, and(eq(businesses.id, subscriptions.businessId), isNull(businesses.deletedAt)))
    .where(
      and(
        eq(subscriptions.status, 'active'),
        sql`${subscriptions.currentPeriodEnd} > ${ts(now)}`,
        sql`${subscriptions.currentPeriodEnd} <= ${ts(addDays(now, PLAN_RENEW_SOON_DAYS))}`,
      ),
    );
  const incomeThis = Number(row?.thisMonth ?? 0) - Number(back?.thisMonth ?? 0);
  const incomeLast = Number(row?.lastMonth ?? 0) - Number(back?.lastMonth ?? 0);
  return {
    incomeThisMonthSen: incomeThis,
    incomeVsLastMonthSen: incomeThis - incomeLast,
    notCompleted: Number(row?.notCompleted ?? 0),
    toCheck: Number(row?.toCheck ?? 0),
    renewSoon: Number(renew?.n ?? 0),
  };
}

/** I8 list: KPIs, then payments newest first, 50 at a time (`beforeId`). */
export async function listPlanPayments(db: Db, query: PlanPaymentsQuery, now: Date = new Date()): Promise<PlanPaymentsResponse> {
  const where = and(filterWhere(query, now), query.beforeId ? lt(payments.id, query.beforeId) : undefined);
  const [rows, k] = await Promise.all([selectRows(db, where, PAGE_SIZE + 1), kpis(db, now)]);
  const page = rows.slice(0, PAGE_SIZE);
  return {
    kpis: k,
    payments: page.map((r) => toRow(r, now)),
    nextBeforeId: rows.length > PAGE_SIZE ? page[page.length - 1]!.id : null,
  };
}

/** I8 "Export CSV": the filtered payments (no paging), amounts in ringgit, Malaysia time, UTF-8 BOM for Excel. */
export async function exportPlanPaymentsCsv(db: Db, query: Pick<PlanPaymentsQuery, 'q' | 'filter'>, now: Date = new Date()): Promise<string> {
  const rows = (await selectRows(db, filterWhere(query, now), PLAN_PAYMENTS_EXPORT_MAX_ROWS)).map((r) => toRow(r, now));
  const header = ['Date (Malaysia time)', 'Business', 'Plan', 'Amount (RM)', 'Method', 'Reference', 'Status', 'Receipt no', 'Recorded by'];
  const lines = rows.map((r) =>
    [
      formatInTimeZone(new Date(r.at), TZ, 'yyyy-MM-dd HH:mm:ss'),
      r.businessName,
      r.planName ?? '',
      (r.amountSen / 100).toFixed(2),
      r.method ?? '',
      r.providerRef ?? '',
      r.status,
      r.receiptNo ?? '',
      r.recordedBy ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  return `﻿${[header.join(','), ...lines].join('\r\n')}\r\n`;
}

export interface RecordTransferDeps {
  db: Db;
  env: Env;
  mailer: Mailer;
}

/**
 * I8 "Record a bank transfer": FTech got the money in its bank account. One transaction creates the paid `manual`
 * payment, moves the plan on by one month (same rules as an online payment), takes the next receipt number and
 * writes the audit row. The receipt email goes out after the commit; if it fails the payment still stands.
 */
export async function recordBankTransfer(
  deps: RecordTransferDeps,
  adminUserId: number,
  input: RecordBankTransferInput,
  now: Date = new Date(),
): Promise<RecordBankTransferResult> {
  const ref = `OBM_${randomBytes(4).toString('hex').toUpperCase()}`;
  const { paymentId, hasEmail } = await deps.db.transaction(async (tx) => {
    const [biz] = await tx
      .select({ id: businesses.id, name: businesses.name })
      .from(businesses)
      .where(and(eq(businesses.id, input.businessId), isNull(businesses.deletedAt)))
      .for('update');
    if (!biz) throw notFound('Business');
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.businessId, biz.id)).for('update');
    if (!sub) throw notFound('Subscription');
    const plan = (await getPlanCatalog(tx)).plans.find((p) => p.code === input.plan);
    if (!plan) throw new AppError(400, 'unknown_plan', 'That plan does not exist');

    // The same bank reference twice is almost always the same transfer entered twice.
    const [same] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(isPlanPayment, eq(payments.provider, 'manual'), sql`lower(${payments.transactionRef}) = lower(${input.bankRef})`))
      .limit(1);
    if (same) {
      throw new AppError(
        409,
        PLAN_PAYMENT_ERRORS.duplicateReference,
        'This bank reference is already recorded. Check the payments list before recording it again.',
      );
    }

    const [saved] = await tx.select().from(billingDetails).where(eq(billingDetails.businessId, biz.id)).limit(1);
    const [owner] = await tx
      .select({ email: users.email })
      .from(businessMembers)
      .innerJoin(users, eq(users.id, businessMembers.userId))
      .where(and(eq(businessMembers.businessId, biz.id), eq(businessMembers.role, 'owner'), eq(businessMembers.isActive, true)))
      .limit(1);
    const receiptEmail = saved?.receiptEmail ?? owner?.email;

    const { period, receiptNo, description } = await applyPaidMonth(tx, sub, plan, biz.id, now);
    const snapshot: PlanReceiptSnapshot = {
      companyName: saved?.companyName ?? biz.name,
      ssmNo: saved?.ssmNo ?? null,
      tin: saved?.tin ?? null,
      address: saved?.address ?? null,
      ...(receiptEmail ? { receiptEmail } : {}),
      plan: input.plan,
      planName: plan.name,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
      description,
    };
    const [created] = await tx
      .insert(payments)
      .values({
        businessId: biz.id,
        subscriptionId: sub.id,
        purpose: 'subscription',
        provider: 'manual',
        method: 'bank_transfer',
        recordedByUserId: adminUserId,
        billCode: ref,
        amountSen: input.amountSen,
        status: 'paid',
        transactionRef: input.bankRef,
        paidAt: now,
        receiptNo,
        receiptSnapshot: snapshot,
      })
      .returning({ id: payments.id });
    await tx.insert(adminAuditLog).values({
      adminUserId,
      businessId: biz.id,
      action: 'record_payment',
      reason: input.reason,
      details: {
        ref,
        receiptNo,
        plan: plan.code,
        amountSen: input.amountSen,
        bankRef: input.bankRef,
        periodEnd: period.end.toISOString(),
        previousPlan: sub.plan,
        previousStatus: sub.status,
      },
    });
    return { paymentId: created!.id, hasEmail: !!receiptEmail };
  });

  let receiptEmailed = hasEmail;
  try {
    await sendReceiptEmail(deps, ref);
  } catch (err) {
    receiptEmailed = false;
    console.error('[admin] receipt email for a recorded bank transfer failed', err);
  }
  const [row] = await selectRows(deps.db, eq(payments.id, paymentId), 1);
  return { payment: toRow(row!, now), receiptEmailed };
}
