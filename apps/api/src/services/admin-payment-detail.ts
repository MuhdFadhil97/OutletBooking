import { formatInTimeZone } from 'date-fns-tz';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { adminAuditLog, businesses, payments, refunds, subscriptions, users, type Db } from '@outletbooking/db';
import {
  DOUBLE_PAYMENT_WINDOW_MINUTES,
  PLAN_PAYMENT_ERRORS,
  PLAN_REFUND_ERRORS,
  PLAN_REFUND_REASONS,
  type PlanPaymentDetail,
  type PlanRefundEntry,
  type PlanRefundReason,
  type RecordPlanRefundInput,
  type RecordPlanRefundResult,
} from '@outletbooking/shared';
import { AppError, notFound } from '../errors';
import { isPlanPayment, MINUTE_MS, rowStatus, selectRows, toRow, ts, TZ, type RecordTransferDeps } from './admin-payments';
import { getReceiptPdf, sendReceiptEmail, type PlanReceiptSnapshot } from './billing';
import { refundEmail } from './billing-emails';

/** I24 · Plan payment detail: double-payment warning, receipt, and recording a refund FTech already paid by bank transfer. */

async function findByRef(db: Db, ref: string) {
  const [row] = await selectRows(db, eq(payments.billCode, ref), 1);
  if (!row) throw notFound('Payment');
  return row;
}

async function refundEntries(db: Db, paymentId: number): Promise<PlanRefundEntry[]> {
  const rows = await db
    .select({
      id: refunds.id,
      amountSen: refunds.amountSen,
      reasonCode: refunds.reasonCode,
      bankRef: refunds.bankRef,
      paidOn: refunds.paidOn,
      createdAt: refunds.createdAt,
      recordedBy: sql<string | null>`(select u.name from ${users} u where u.id = ${refunds.recordedByUserId})`,
    })
    .from(refunds)
    .where(and(eq(refunds.paymentId, paymentId), isNull(refunds.bookingId)))
    .orderBy(asc(refunds.id));
  const known: readonly string[] = PLAN_REFUND_REASONS;
  return rows.map((r) => ({
    id: r.id,
    amountSen: r.amountSen,
    reasonCode: r.reasonCode && known.includes(r.reasonCode) ? (r.reasonCode as PlanRefundReason) : null,
    bankRef: r.bankRef,
    paidOn: r.paidOn,
    recordedBy: r.recordedBy,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** One plan payment with its refunds, the double-payment warning and the business's plan today. */
export async function getPlanPaymentDetail(db: Db, ref: string, now: Date = new Date()): Promise<PlanPaymentDetail> {
  const row = await findByRef(db, ref);
  const snap = (row.snapshot ?? {}) as PlanReceiptSnapshot;
  const [[biz], [sub], entries] = await Promise.all([
    db.select({ slug: businesses.slug }).from(businesses).where(eq(businesses.id, row.businessId)),
    db.select().from(subscriptions).where(eq(subscriptions.businessId, row.businessId)).limit(1),
    refundEntries(db, row.id),
  ]);
  const refundedSen = entries.reduce((sum, e) => sum + e.amountSen, 0);

  let possibleDouble: PlanPaymentDetail['possibleDouble'] = [];
  if (row.paidAt && (row.status === 'paid' || row.status === 'refunded')) {
    const window = DOUBLE_PAYMENT_WINDOW_MINUTES * MINUTE_MS;
    const others = await selectRows(
      db,
      and(
        eq(payments.businessId, row.businessId),
        sql`${payments.id} <> ${row.id}`,
        eq(payments.amountSen, row.amountSen),
        inArray(payments.status, ['paid', 'refunded']),
        sql`${payments.paidAt} between ${ts(new Date(row.paidAt.getTime() - window))} and ${ts(new Date(row.paidAt.getTime() + window))}`,
      ),
      5,
    );
    possibleDouble = others.map((o) => ({
      ref: o.ref ?? '',
      receiptNo: o.receiptNo,
      at: (o.paidAt ?? o.createdAt).toISOString(),
      status: rowStatus(o, now),
    }));
  }

  return {
    payment: toRow(row, now),
    periodStart: snap.periodStart ?? null,
    periodEnd: snap.periodEnd ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    businessSlug: biz?.slug ?? '',
    billedTo: snap.companyName ?? null,
    receiptEmail: snap.receiptEmail ?? null,
    refunds: entries,
    refundedSen,
    refundableSen: row.status === 'paid' ? Math.max(0, row.amountSen - refundedSen) : 0,
    possibleDouble,
    subscription: sub
      ? { plan: sub.plan, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null }
      : null,
  };
}

/** "Download receipt": the same PDF the owner gets (a receipt holds billing details, not customer data). */
export async function getPlanReceiptPdfForAdmin(db: Db, ref: string): Promise<{ filename: string; pdf: Buffer }> {
  const row = await findByRef(db, ref);
  return getReceiptPdf(db, row.businessId, ref);
}

/** "Resend receipt": emails the receipt PDF again to the address saved with the payment. Audited with a reason. */
export async function resendPlanReceipt(
  deps: RecordTransferDeps,
  adminUserId: number,
  ref: string,
  reason: string,
): Promise<{ sentTo: string }> {
  const row = await findByRef(deps.db, ref);
  const snap = (row.snapshot ?? {}) as PlanReceiptSnapshot;
  if (row.status !== 'paid' || !row.receiptNo) {
    throw new AppError(409, PLAN_REFUND_ERRORS.notPaid, 'Only a paid payment has a receipt to send');
  }
  if (!snap.receiptEmail) throw new AppError(409, 'no_receipt_email', 'This payment has no receipt email address saved');
  await sendReceiptEmail(deps, ref);
  await deps.db.insert(adminAuditLog).values({
    adminUserId,
    businessId: row.businessId,
    action: 'resend_link',
    reason,
    details: { link: 'receipt', ref, receiptNo: row.receiptNo },
  });
  return { sentTo: snap.receiptEmail };
}

/**
 * "Record a refund": FTech has already paid the money back by bank transfer; this records it. One transaction inserts
 * the refund (paying back everything marks the payment refunded), optionally ends the plan now, and writes the audit
 * row. The refund note (naming the original receipt) is emailed after the commit; if that fails the refund stays.
 */
export async function recordPlanRefund(
  deps: RecordTransferDeps,
  adminUserId: number,
  ref: string,
  input: RecordPlanRefundInput,
  now: Date = new Date(),
): Promise<RecordPlanRefundResult> {
  if (input.paidOn > formatInTimeZone(now, TZ, 'yyyy-MM-dd')) {
    throw new AppError(400, PLAN_REFUND_ERRORS.futureDate, 'The refund date cannot be in the future');
  }
  const found = await findByRef(deps.db, ref);

  const { snapshot, full } = await deps.db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.id, found.id), isPlanPayment))
      .for('update');
    if (!p) throw notFound('Payment');
    if (p.status !== 'paid') {
      throw new AppError(
        409,
        PLAN_REFUND_ERRORS.notPaid,
        p.status === 'refunded' ? 'This payment is already fully refunded' : 'Only a paid payment can be refunded',
      );
    }
    const [paidBack] = await tx
      .select({ n: sql<number>`coalesce(sum(${refunds.amountSen}), 0)::int` })
      .from(refunds)
      .where(and(eq(refunds.paymentId, p.id), isNull(refunds.bookingId)));
    const refundable = p.amountSen - Number(paidBack?.n ?? 0);
    if (input.amountSen > refundable) {
      throw new AppError(
        409,
        PLAN_REFUND_ERRORS.tooLarge,
        `At most RM ${(refundable / 100).toFixed(2)} can still be refunded on this payment`,
      );
    }
    // The same refund transfer entered twice is the usual mistake.
    const [same] = await tx
      .select({ id: refunds.id })
      .from(refunds)
      .where(and(isNull(refunds.bookingId), sql`lower(${refunds.bankRef}) = lower(${input.bankRef})`))
      .limit(1);
    if (same) {
      throw new AppError(409, PLAN_PAYMENT_ERRORS.duplicateReference, 'This bank reference is already recorded as a refund.');
    }

    await tx.insert(refunds).values({
      businessId: p.businessId,
      paymentId: p.id,
      bookingId: null,
      amountSen: input.amountSen,
      method: 'bank_transfer',
      reason: input.reason,
      reasonCode: input.reasonCode,
      bankRef: input.bankRef,
      paidOn: input.paidOn,
      recordedByUserId: adminUserId,
    });
    const isFull = input.amountSen === refundable;
    if (isFull) await tx.update(payments).set({ status: 'refunded' }).where(eq(payments.id, p.id));

    if (input.planAfter === 'end_now') {
      // "cancelled" keeps access only until current_period_end, which is now: the plan stops at once.
      await tx
        .update(subscriptions)
        .set({ status: 'cancelled', currentPeriodEnd: now, freeUntil: null })
        .where(eq(subscriptions.businessId, p.businessId));
    }
    await tx.insert(adminAuditLog).values({
      adminUserId,
      businessId: p.businessId,
      action: 'record_refund',
      reason: input.reason,
      details: {
        ref,
        receiptNo: p.receiptNo,
        amountSen: input.amountSen,
        reasonCode: input.reasonCode,
        bankRef: input.bankRef,
        paidOn: input.paidOn,
        planAfter: input.planAfter,
        full: isFull,
      },
    });
    return { snapshot: (p.receiptSnapshot ?? {}) as PlanReceiptSnapshot, full: isFull };
  });

  let refundEmailed = !!snapshot.receiptEmail;
  if (snapshot.receiptEmail) {
    try {
      const site = deps.env.WEBSITE_URL.replace(/\/+$/, '');
      await deps.mailer.send({
        to: snapshot.receiptEmail,
        ...refundEmail({
          receiptNo: found.receiptNo ?? '',
          planName: snapshot.planName ?? 'OutletBooking',
          refundSen: input.amountSen,
          kind: full ? 'full' : 'part',
          paidOn: formatInTimeZone(new Date(`${input.paidOn}T12:00:00+08:00`), TZ, 'd MMM yyyy'),
          planEnded: input.planAfter === 'end_now',
          accountUrl: `${site}/billing/account`,
          websiteUrl: site,
        }),
      });
    } catch (err) {
      refundEmailed = false;
      console.error('[admin] refund note email failed', err);
    }
  }
  return { detail: await getPlanPaymentDetail(deps.db, ref, now), refundEmailed };
}
