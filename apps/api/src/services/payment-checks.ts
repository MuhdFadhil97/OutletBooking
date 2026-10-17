import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, notExists, sql } from 'drizzle-orm';
import { adminAuditLog, bookings, businesses, paymentChecks, payments, type Db } from '@outletbooking/db';
import {
  PAYMENT_CHECK_AFTER_MINUTES,
  PAYMENT_CHECK_UNTIL_MINUTES,
  type AdminAction,
  type PaymentCheckItem,
  type PaymentCheckProblem,
  type RecheckResult,
} from '@outletbooking/shared';
import { AppError, notFound } from '../errors';
import { recordPaymentCheck, resolvePaymentChecks } from './payment-check-log';
import type { Env } from '../env';
import { sendReceiptEmail, syncPlanPayment } from './billing';
import type { Mailer } from './mailer';
import { bookingRef, notifyPayment, syncBill } from './payments';
import type { PushSender } from './push';
import type { ToyyibPayClient } from './toyyibpay';

/**
 * I27 · ToyyibPay payments to check. A "check" is an open question about one payment: the callback said paid but the
 * re-check disagrees, the re-check could not be done, or a paid bill never reached us. Every place that re-checks a bill
 * with ToyyibPay records one when something is wrong, so the list is filled by the real payment paths — not a guess —
 * and closes itself when the payment becomes paid. "Re-check now" asks ToyyibPay again on the server; the admin never
 * sees anyone's key (the bill status needs only the bill code) or the customer's details.
 */

export interface PaymentCheckDeps {
  db: Db;
  env: Env;
  toyyibpay: ToyyibPayClient;
  push: PushSender;
  mailer: Mailer;
}

type Q = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export { recordPaymentCheck, resolvePaymentChecks };

const select = (q: Q) =>
  q
    .select({
      id: paymentChecks.id,
      checkedAt: paymentChecks.checkedAt,
      problem: paymentChecks.problem,
      callbackStatus: paymentChecks.callbackStatus,
      recheckStatus: paymentChecks.recheckStatus,
      paymentId: payments.id,
      purpose: payments.purpose,
      billCode: payments.billCode,
      amountSen: payments.amountSen,
      status: payments.status,
      businessId: businesses.id,
      businessName: businesses.name,
      bookingToken: bookings.publicToken,
    })
    .from(paymentChecks)
    .innerJoin(payments, eq(payments.id, paymentChecks.paymentId))
    .innerJoin(businesses, eq(businesses.id, payments.businessId))
    .leftJoin(bookings, and(eq(bookings.businessId, payments.businessId), eq(bookings.id, payments.bookingId)));

type CheckRecord = Awaited<ReturnType<ReturnType<typeof select>['execute']>>[number];

function toItem(r: CheckRecord): PaymentCheckItem {
  return {
    id: r.id,
    checkedAt: r.checkedAt.toISOString(),
    problem: r.problem as PaymentCheckProblem,
    callbackStatus: r.callbackStatus,
    recheckStatus: r.recheckStatus,
    business: { id: r.businessId, name: r.businessName },
    kind: r.purpose === 'subscription' ? 'plan' : 'booking',
    bookingRef: r.bookingToken ? bookingRef(r.bookingToken) : null,
    billCode: r.billCode ?? '',
    amountSen: r.amountSen,
  };
}

/** Open checks, newest first. A payment that is paid or refunded is not a problem any more, whatever its row says. */
export async function listPaymentChecks(db: Db): Promise<PaymentCheckItem[]> {
  const rows = await select(db)
    .where(and(isNull(paymentChecks.resolvedAt), inArray(payments.status, ['pending', 'failed', 'expired'])))
    .orderBy(desc(paymentChecks.checkedAt), desc(paymentChecks.id))
    .limit(100);
  return rows.map(toItem);
}

export async function countPaymentChecks(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(paymentChecks)
    .innerJoin(payments, eq(payments.id, paymentChecks.paymentId))
    .where(and(isNull(paymentChecks.resolvedAt), inArray(payments.status, ['pending', 'failed', 'expired'])));
  return row?.n ?? 0;
}

async function audit(db: Db, adminUserId: number, businessId: number, summary: string, checkId: number) {
  const action: AdminAction = 'recheck_payment';
  await db.insert(adminAuditLog).values({ adminUserId, businessId, action, reason: summary, details: { summary, checkId } });
}

/**
 * "Re-check now": ask ToyyibPay about the bill again. If it says paid, the payment is applied exactly as a callback would
 * (booking confirmed, or plan period and receipt) and the check closes. Otherwise the check stays, with what ToyyibPay said.
 */
export async function recheckPayment(deps: PaymentCheckDeps, adminUserId: number, checkId: number, now: Date = new Date()): Promise<RecheckResult> {
  const [check] = await select(deps.db).where(eq(paymentChecks.id, checkId));
  if (!check) throw notFound('Payment check');
  if (check.billCode === null) throw new AppError(409, 'no_bill', 'This payment has no ToyyibPay bill to check');
  const bill = check.billCode;
  const label = `Payment check #${checkId} · bill ${bill}`;

  if (check.status === 'paid' || check.status === 'refunded') {
    await resolvePaymentChecks(deps.db, check.paymentId, adminUserId, now);
    await audit(deps.db, adminUserId, check.businessId, `${label} · already paid, check closed`, checkId);
    return { outcome: 'paid', resolved: true };
  }

  let txs;
  try {
    txs = await deps.toyyibpay.getBillTransactions(bill);
  } catch (err) {
    console.error('[payment-checks] re-check failed', err instanceof Error ? err.message : err);
    await recordPaymentCheck(deps.db, check.paymentId, 'recheck_failed', null, 'Could not reach ToyyibPay', now);
    await audit(deps.db, adminUserId, check.businessId, `${label} · ToyyibPay could not be reached`, checkId);
    return { outcome: 'error', resolved: false };
  }

  if (txs.some((t) => t.billpaymentStatus === '1')) {
    // Apply it the same way a callback would; both functions re-check by themselves and apply once.
    if (check.purpose === 'subscription') {
      const r = await syncPlanPayment(deps, bill, { now });
      if (r?.justPaid) void sendReceiptEmail(deps, bill).catch((e: unknown) => console.error('[payment-checks] receipt email failed', e instanceof Error ? e.message : e));
    } else {
      const r = await syncBill(deps, bill);
      if (r) void notifyPayment(deps, r).catch((e: unknown) => console.error('[payment-checks] notify failed', e instanceof Error ? e.message : e));
    }
    const [after] = await deps.db.select({ status: payments.status }).from(payments).where(eq(payments.id, check.paymentId));
    if (after?.status === 'paid') {
      await resolvePaymentChecks(deps.db, check.paymentId, adminUserId, now);
      // Applying the payment already closed the check as "by the system"; it was this admin's re-check that did it.
      await deps.db
        .update(paymentChecks)
        .set({ resolvedByUserId: adminUserId })
        .where(and(eq(paymentChecks.id, checkId), isNotNull(paymentChecks.resolvedAt), isNull(paymentChecks.resolvedByUserId)));
      await audit(deps.db, adminUserId, check.businessId, `${label} · ToyyibPay says paid, applied`, checkId);
      return { outcome: 'paid', resolved: true };
    }
    // Paid at ToyyibPay but not applied (for example the amount is short): keep it open for a person.
    await audit(deps.db, adminUserId, check.businessId, `${label} · ToyyibPay says paid but it could not be applied`, checkId);
    return { outcome: 'still_pending', resolved: false };
  }

  const declined = txs.some((t) => t.billpaymentStatus === '3');
  const status = declined ? 'failed' : 'pending';
  await deps.db.update(paymentChecks).set({ checkedAt: now, recheckStatus: status }).where(eq(paymentChecks.id, checkId));
  await audit(deps.db, adminUserId, check.businessId, `${label} · ToyyibPay says ${status}`, checkId);
  return { outcome: declined ? 'failed' : 'still_pending', resolved: false };
}

/** Close a check without a payment (the customer really did not pay, or it was dealt with outside). A reason is kept in the audit log. */
export async function closePaymentCheck(db: Db, adminUserId: number, checkId: number, reason: string, now: Date = new Date()): Promise<void> {
  const [check] = await select(db).where(eq(paymentChecks.id, checkId));
  if (!check) throw notFound('Payment check');
  await db
    .update(paymentChecks)
    .set({ resolvedAt: now, resolvedByUserId: adminUserId })
    .where(and(eq(paymentChecks.id, checkId), isNull(paymentChecks.resolvedAt)));
  await audit(db, adminUserId, check.businessId, `Payment check #${checkId} · bill ${check.billCode ?? ''} closed: ${reason}`, checkId);
}

/**
 * Job (every 10 minutes): a ToyyibPay bill still pending 30 minutes after it was made, for up to two hours, is asked
 * about once per run. If ToyyibPay says it was paid, it is applied (and logged as a closed "no callback" check, so the
 * missing callback is visible in the history); if the question fails, a "re-check failed" check opens. Bills nobody
 * paid are left alone.
 */
export async function scanPendingPayments(deps: PaymentCheckDeps, now: Date = new Date()): Promise<{ checked: number; applied: number }> {
  const oldest = new Date(now.getTime() - PAYMENT_CHECK_UNTIL_MINUTES * 60_000);
  const newest = new Date(now.getTime() - PAYMENT_CHECK_AFTER_MINUTES * 60_000);
  const rows = await deps.db
    .select({ id: payments.id, billCode: payments.billCode, purpose: payments.purpose })
    .from(payments)
    .where(
      and(
        eq(payments.provider, 'toyyibpay'),
        eq(payments.status, 'pending'),
        isNotNull(payments.billCode),
        gte(payments.createdAt, oldest),
        lt(payments.createdAt, newest),
        // A payment with an open check is already in front of a person.
        notExists(
          deps.db
            .select({ one: sql`1` })
            .from(paymentChecks)
            .where(and(eq(paymentChecks.paymentId, payments.id), isNull(paymentChecks.resolvedAt))),
        ),
      ),
    )
    .orderBy(asc(payments.createdAt))
    .limit(50);

  let applied = 0;
  for (const p of rows) {
    const bill = p.billCode!;
    try {
      if (p.purpose === 'subscription') {
        const r = await syncPlanPayment(deps, bill, { now });
        if (r?.justPaid) {
          applied++;
          await deps.db.insert(paymentChecks).values({ paymentId: p.id, problem: 'no_callback', recheckStatus: 'paid', checkedAt: now, resolvedAt: now });
          void sendReceiptEmail(deps, bill).catch((e: unknown) => console.error('[payment-checks] receipt email failed', e instanceof Error ? e.message : e));
        }
      } else {
        const r = await syncBill(deps, bill);
        if (r) {
          applied++;
          await deps.db.insert(paymentChecks).values({ paymentId: p.id, problem: 'no_callback', recheckStatus: 'paid', checkedAt: now, resolvedAt: now });
          void notifyPayment(deps, r).catch((e: unknown) => console.error('[payment-checks] notify failed', e instanceof Error ? e.message : e));
        }
      }
    } catch (err) {
      console.error('[payment-checks] scan failed for a bill', err instanceof Error ? err.message : err);
    }
  }
  return { checked: rows.length, applied };
}
