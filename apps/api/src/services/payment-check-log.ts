import { and, eq, isNull } from 'drizzle-orm';
import { paymentChecks, type Db } from '@outletbooking/db';
import type { PaymentCheckProblem } from '@outletbooking/shared';

/** The little half of I27's payment checks that the payment services call (kept apart to avoid an import cycle). */
type Q = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Open (or refresh) the check for this payment and problem. One open check per payment and problem, so a ToyyibPay
 * outage during many return-page polls shows as one row, not hundreds.
 */
export async function recordPaymentCheck(
  db: Q,
  paymentId: number,
  problem: PaymentCheckProblem,
  callbackStatus: string | null,
  recheckStatus: string | null,
  now: Date = new Date(),
): Promise<void> {
  try {
    const [open] = await db
      .select({ id: paymentChecks.id })
      .from(paymentChecks)
      .where(and(eq(paymentChecks.paymentId, paymentId), eq(paymentChecks.problem, problem), isNull(paymentChecks.resolvedAt)))
      .limit(1);
    if (open) {
      await db
        .update(paymentChecks)
        .set({ checkedAt: now, recheckStatus, ...(callbackStatus !== null ? { callbackStatus } : {}) })
        .where(eq(paymentChecks.id, open.id));
    } else {
      await db.insert(paymentChecks).values({ paymentId, problem, callbackStatus, recheckStatus, checkedAt: now });
    }
  } catch (err) {
    // Recording a problem must never break a payment: log and carry on.
    console.error('[payment-checks] could not record', err instanceof Error ? err.message : err);
  }
}

/** The payment is fine now (paid): close its open checks. `adminUserId` null = closed by the system. */
export async function resolvePaymentChecks(db: Q, paymentId: number, adminUserId: number | null = null, now: Date = new Date()): Promise<void> {
  try {
    await db
      .update(paymentChecks)
      .set({ resolvedAt: now, resolvedByUserId: adminUserId })
      .where(and(eq(paymentChecks.paymentId, paymentId), isNull(paymentChecks.resolvedAt)));
  } catch (err) {
    console.error('[payment-checks] could not resolve', err instanceof Error ? err.message : err);
  }
}
