import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  bookings,
  businesses,
  customers,
  paymentAccounts,
  payments,
  services,
  users,
  type Db,
  type Tx,
} from '@outletbooking/db';
import type {
  BookingPayments,
  BookingStatus,
  ManualPaymentInput,
  PaymentAccountView,
  PaymentMethod,
  PaymentPurpose,
  PaymentRecord,
  PaymentRecordStatus,
  PaymentTest,
  PublicPayment,
} from '@outletbooking/shared';
import type { Env } from '../env';
import { AppError, notFound } from '../errors';
import { recordBookingEvent } from './booking-events';
import { guardOverlap } from './bookings';
import { decryptSecret, encryptSecret, parseEncryptionKey } from './crypto';
import { notifyBooking, Outbox } from './notifications';
import { createToyyibPay, ToyyibPayError, type ToyyibPayClient } from './toyyibpay';

type Q = Db | Tx;

/** Everything the payment code needs besides the database. */
export interface PaymentDeps {
  toyyibpay: ToyyibPayClient;
  /** APP_ENCRYPTION_KEY; null = not configured (connecting is refused with a clear message). */
  key: Buffer | null;
  /** Where ToyyibPay posts the callback. */
  apiPublicUrl: string;
  /** Booking page base (return URL after paying). */
  appPublicUrl: string;
}

export function createPaymentDeps(env: Env, toyyibpay: ToyyibPayClient = createToyyibPay(env.TOYYIBPAY_BASE_URL)): PaymentDeps {
  return {
    toyyibpay,
    key: env.APP_ENCRYPTION_KEY ? parseEncryptionKey(env.APP_ENCRYPTION_KEY) : null,
    apiPublicUrl: (env.API_PUBLIC_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, ''),
    appPublicUrl: env.APP_PUBLIC_URL.replace(/\/+$/, ''),
  };
}

const callbackUrl = (deps: PaymentDeps) => `${deps.apiPublicUrl}/payments/toyyibpay/callback`;

/** ToyyibPay errors become a 502 the app can show as-is (never with the key in it). */
function gatewayError(err: unknown): never {
  if (err instanceof ToyyibPayError) throw new AppError(502, 'toyyibpay_error', err.message);
  throw err;
}

// ---------------------------------------------------------------- H1 · connect

async function accountRow(q: Q, businessId: number) {
  const [row] = await q.select().from(paymentAccounts).where(eq(paymentAccounts.businessId, businessId));
  return row ?? null;
}

const toView = (row: Awaited<ReturnType<typeof accountRow>>): PaymentAccountView => ({
  status: (row?.status ?? 'not_connected') as PaymentAccountView['status'],
  secretKeyLast4: row?.status === 'connected' ? row.secretKeyLast4 : null,
  categoryCode: row?.status === 'connected' ? row.categoryCode : null,
  connectedAt: row?.status === 'connected' ? row.updatedAt.toISOString() : null,
  testedAt: row?.testedAt?.toISOString() ?? null,
  lastError: row?.lastError ?? null,
});

export async function getPaymentAccount(db: Db, businessId: number): Promise<PaymentAccountView> {
  return toView(await accountRow(db, businessId));
}

/** The business's decrypted key + category, or null when not connected. Never leaves the API. */
async function liveAccount(q: Q, deps: PaymentDeps, businessId: number) {
  const row = await accountRow(q, businessId);
  if (row?.status !== 'connected' || !row.secretKeyEncrypted || !row.categoryCode || !deps.key) return null;
  return { secretKey: decryptSecret(row.secretKeyEncrypted, deps.key), categoryCode: row.categoryCode };
}

export async function isOnlinePaymentAvailable(q: Q, businessId: number): Promise<boolean> {
  const row = await accountRow(q, businessId);
  return row?.status === 'connected';
}

/**
 * Checks the key by creating the business's payment category with it ("OutletBooking · <name>").
 * Only a key ToyyibPay accepts is stored — encrypted, with its last 4 characters for display.
 */
export async function connectPaymentAccount(
  db: Db,
  deps: PaymentDeps,
  businessId: number,
  userId: number,
  secretKey: string,
): Promise<PaymentAccountView> {
  if (!deps.key) {
    throw new AppError(500, 'encryption_not_configured', 'Online payments are not set up on the server yet (APP_ENCRYPTION_KEY).');
  }
  const [biz] = await db.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, businessId));
  if (!biz) throw notFound('Business');
  let categoryCode: string;
  try {
    categoryCode = await deps.toyyibpay.createCategory(secretKey, `OutletBooking ${biz.name}`, `Bookings at ${biz.name} via OutletBooking`);
  } catch (err) {
    if (err instanceof ToyyibPayError) {
      throw new AppError(400, 'toyyibpay_key_rejected', 'ToyyibPay did not accept this key. Copy the User Secret Key again and paste it here.');
    }
    throw err;
  }
  const values = {
    status: 'connected',
    secretKeyEncrypted: encryptSecret(secretKey, deps.key),
    secretKeyLast4: secretKey.slice(-4),
    categoryCode,
    lastError: null,
    testedAt: null,
    testBillCode: null,
    connectedByUserId: userId,
  };
  await db
    .insert(paymentAccounts)
    .values({ businessId, ...values })
    .onConflictDoUpdate({ target: paymentAccounts.businessId, set: values });
  return getPaymentAccount(db, businessId);
}

/** Forgets the key. Bills already sent keep working on ToyyibPay's side; callbacks are still checked. */
export async function disconnectPaymentAccount(db: Db, businessId: number): Promise<PaymentAccountView> {
  await db
    .update(paymentAccounts)
    .set({ status: 'not_connected', secretKeyEncrypted: null, secretKeyLast4: null, testBillCode: null, lastError: null })
    .where(eq(paymentAccounts.businessId, businessId));
  return getPaymentAccount(db, businessId);
}

/** H1 · RM 1.00 test bill on the business's own account. */
export async function startPaymentTest(db: Db, deps: PaymentDeps, businessId: number): Promise<PaymentTest> {
  const account = await liveAccount(db, deps, businessId);
  if (!account) throw new AppError(409, 'not_connected', 'Connect ToyyibPay first');
  const [biz] = await db
    .select({ name: businesses.name, email: businesses.email, phone: businesses.phone })
    .from(businesses)
    .where(eq(businesses.id, businessId));
  const billCode = await deps.toyyibpay
    .createBill(account.secretKey, {
      categoryCode: account.categoryCode,
      name: 'OutletBooking test',
      description: `Test payment for ${biz?.name ?? 'your business'}`,
      amountSen: 100,
      returnUrl: `${deps.apiPublicUrl}/payments/toyyibpay/done`,
      callbackUrl: callbackUrl(deps),
      externalRef: `TEST-${businessId}`,
      payerName: biz?.name ?? 'Test',
      payerEmail: biz?.email,
      payerPhone: biz?.phone,
    })
    .catch(gatewayError);
  await db.update(paymentAccounts).set({ testBillCode: billCode }).where(eq(paymentAccounts.businessId, businessId));
  return { url: deps.toyyibpay.paymentUrl(billCode), billCode, passed: false };
}

/** Re-checks the test bill with ToyyibPay; ticks `tested_at` once paid. */
export async function checkPaymentTest(db: Db, deps: PaymentDeps, businessId: number): Promise<PaymentAccountView> {
  const row = await accountRow(db, businessId);
  if (row?.status !== 'connected' || !row.testBillCode) throw new AppError(409, 'no_test', 'Start the RM 1.00 test first');
  const txs = await deps.toyyibpay.getBillTransactions(row.testBillCode).catch(gatewayError);
  if (txs.some((t) => t.status === 'paid')) {
    await db
      .update(paymentAccounts)
      .set({ testedAt: sql`coalesce(${paymentAccounts.testedAt}, now())` })
      .where(eq(paymentAccounts.businessId, businessId));
  }
  return getPaymentAccount(db, businessId);
}

// ---------------------------------------------------------------- bills for bookings

const purposeFor = (amountDueSen: number, priceSen: number): PaymentPurpose =>
  amountDueSen >= priceSen ? 'full_payment' : 'deposit';

/**
 * The ToyyibPay page for a pending, unpaid booking: reuses the open bill, or creates one with the
 * business's own key (deposit or full amount). Returns the URL to send the customer to.
 */
export async function payLinkForBooking(
  db: Db,
  deps: PaymentDeps,
  businessId: number,
  bookingId: number,
  now = new Date(),
): Promise<{ url: string; created: boolean }> {
  const [b] = await db
    .select({
      status: bookings.status,
      paymentStatus: bookings.paymentStatus,
      amountDueSen: bookings.amountDueSen,
      priceSen: bookings.priceSen,
      expiresAt: bookings.expiresAt,
      token: bookings.publicToken,
      slug: businesses.slug,
      businessName: businesses.name,
      serviceName: services.name,
      customerName: customers.name,
      customerEmail: customers.email,
      customerPhone: customers.phone,
    })
    .from(bookings)
    .innerJoin(businesses, eq(businesses.id, bookings.businessId))
    .innerJoin(services, and(eq(services.businessId, bookings.businessId), eq(services.id, bookings.serviceId)))
    .innerJoin(customers, and(eq(customers.businessId, bookings.businessId), eq(customers.id, bookings.customerId)))
    .where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId)));
  if (!b) throw notFound('Booking');
  if (b.paymentStatus !== 'unpaid' || b.amountDueSen <= 0) throw new AppError(409, 'nothing_to_pay', 'This booking has nothing to pay online');
  if (b.status !== 'pending' && b.status !== 'confirmed') {
    throw new AppError(409, 'booking_closed', 'This booking is no longer open for payment');
  }
  if (b.status === 'pending' && b.expiresAt && b.expiresAt <= now) {
    throw new AppError(409, 'hold_expired', 'The time to pay has run out. Please book again.');
  }

  const [open] = await db
    .select({ billCode: payments.billCode })
    .from(payments)
    .where(
      and(
        eq(payments.businessId, businessId),
        eq(payments.bookingId, bookingId),
        eq(payments.provider, 'toyyibpay'),
        eq(payments.status, 'pending'),
        eq(payments.amountSen, b.amountDueSen),
      ),
    )
    .orderBy(desc(payments.id))
    .limit(1);
  if (open?.billCode) return { url: deps.toyyibpay.paymentUrl(open.billCode), created: false };

  const account = await liveAccount(db, deps, businessId);
  if (!account) throw new AppError(409, 'online_payment_unavailable', 'This business does not take online payments yet');
  const ref = b.token.slice(0, 4).toUpperCase();
  const billCode = await deps.toyyibpay
    .createBill(account.secretKey, {
      categoryCode: account.categoryCode,
      name: b.serviceName,
      description: `${b.businessName} booking ${ref}`,
      amountSen: b.amountDueSen,
      returnUrl: `${deps.appPublicUrl}/book/${b.slug}/b/${b.token}`,
      callbackUrl: callbackUrl(deps),
      externalRef: `BK-${ref}-${bookingId}`,
      payerName: b.customerName,
      payerEmail: b.customerEmail,
      payerPhone: b.customerPhone,
    })
    .catch(gatewayError);
  await db.insert(payments).values({
    businessId,
    bookingId,
    purpose: purposeFor(b.amountDueSen, b.priceSen),
    provider: 'toyyibpay',
    billCode,
    amountSen: b.amountDueSen,
    status: 'pending',
  });
  return { url: deps.toyyibpay.paymentUrl(billCode), created: true };
}

/** Booking id behind a public token (customer pay button). */
export async function bookingByToken(q: Q, token: string) {
  const [b] = await q
    .select({ id: bookings.id, businessId: bookings.businessId })
    .from(bookings)
    .where(eq(bookings.publicToken, token));
  if (!b) throw notFound('Booking');
  return b;
}

// ---------------------------------------------------------------- callback / re-check

export type SyncResult = 'paid' | 'already_paid' | 'failed' | 'pending' | 'test' | 'unknown';

/**
 * The only way a bill becomes paid: ask ToyyibPay (getBillTransactions) — never trust the callback body.
 * Idempotent: a second callback or refresh for a paid bill changes nothing.
 */
export async function syncBill(
  db: Db,
  deps: PaymentDeps,
  billCode: string,
  outbox = new Outbox(),
  raw?: Record<string, string>,
  now = new Date(),
): Promise<SyncResult> {
  const [payment] = await db.select().from(payments).where(eq(payments.billCode, billCode));
  if (!payment) {
    const [test] = await db
      .select({ businessId: paymentAccounts.businessId })
      .from(paymentAccounts)
      .where(eq(paymentAccounts.testBillCode, billCode));
    if (!test) return 'unknown';
    await checkPaymentTest(db, deps, test.businessId).catch(() => undefined);
    return 'test';
  }
  if (payment.status === 'paid' || payment.status === 'refunded') return 'already_paid';

  const txs = await deps.toyyibpay.getBillTransactions(billCode);
  const paid = txs.find((t) => t.status === 'paid' && t.amountSen >= payment.amountSen);
  if (paid) return markPaid(db, payment.id, { ref: paid.invoiceNo, raw, now }, outbox);
  if (txs.length && txs.every((t) => t.status === 'failed') && payment.status === 'pending') {
    return markFailed(db, payment.id, raw, outbox);
  }
  return 'pending';
}

async function markPaid(
  db: Db,
  paymentId: number,
  info: { ref: string | null; raw?: Record<string, string>; now: Date },
  outbox: Outbox,
): Promise<SyncResult> {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
    if (!p || p.status === 'paid' || p.status === 'refunded') return 'already_paid';
    await tx
      .update(payments)
      .set({ status: 'paid', paidAt: info.now, transactionRef: info.ref, method: 'fpx', ...(info.raw ? { rawCallback: info.raw } : {}) })
      .where(eq(payments.id, paymentId));
    if (p.bookingId === null) return 'paid';
    await applyPaymentToBooking(tx, p.businessId, p.bookingId, { amountSen: p.amountSen, actorUserId: null, via: 'toyyibpay' }, outbox);
    return 'paid';
  });
}

async function markFailed(db: Db, paymentId: number, raw: Record<string, string> | undefined, outbox: Outbox): Promise<SyncResult> {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
    if (!p || p.status !== 'pending') return 'already_paid';
    await tx
      .update(payments)
      .set({ status: 'failed', ...(raw ? { rawCallback: raw } : {}) })
      .where(eq(payments.id, paymentId));
    if (p.bookingId === null) return 'failed';
    const [b] = await tx
      .select({ status: bookings.status, expiresAt: bookings.expiresAt })
      .from(bookings)
      .where(and(eq(bookings.businessId, p.businessId), eq(bookings.id, p.bookingId)));
    await recordBookingEvent(tx, {
      businessId: p.businessId,
      bookingId: p.bookingId,
      type: 'payment_failed',
      actorUserId: null,
      details: { amountSen: p.amountSen, billCode: p.billCode },
    });
    if (b?.status === 'pending') {
      await notifyBooking(tx, outbox, p.businessId, p.bookingId, null, { kind: 'payment_failed', heldUntil: b.expiresAt });
    }
    return 'failed';
  });
}

/**
 * A payment landed on a booking (online or recorded by hand), inside the caller's transaction:
 * `paid` event, payment status, and — for a pending booking — confirmation (if the business
 * auto-confirms paid bookings). A booking already released for non-payment is revived when its
 * slot is still free; otherwise it stays cancelled and the owner is told to refund.
 */
export async function applyPaymentToBooking(
  tx: Tx,
  businessId: number,
  bookingId: number,
  pay: { amountSen: number; actorUserId: number | null; via: 'toyyibpay' | 'manual'; method?: PaymentMethod },
  outbox: Outbox,
): Promise<void> {
  const [b] = await tx
    .select({
      status: bookings.status,
      amountDueSen: bookings.amountDueSen,
      paymentStatus: bookings.paymentStatus,
      cancelReason: bookings.cancelReason,
      autoConfirm: businesses.autoConfirmPaid,
    })
    .from(bookings)
    .innerJoin(businesses, eq(businesses.id, bookings.businessId))
    .where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId)))
    .for('update', { of: bookings });
  if (!b) throw notFound('Booking');

  const [sum] = await tx
    .select({ paid: sql<number>`coalesce(sum(${payments.amountSen}), 0)::int` })
    .from(payments)
    .where(and(eq(payments.businessId, businessId), eq(payments.bookingId, bookingId), eq(payments.status, 'paid')));
  const covered = (sum?.paid ?? 0) >= b.amountDueSen;

  await recordBookingEvent(tx, {
    businessId,
    bookingId,
    type: 'paid',
    actorUserId: pay.actorUserId,
    details: { amountSen: pay.amountSen, via: pay.via, ...(pay.method ? { method: pay.method } : {}) },
  });
  if (covered && b.paymentStatus === 'unpaid') {
    await tx.update(bookings).set({ paymentStatus: 'paid' }).where(eq(bookings.id, bookingId));
  }

  const from = b.status as BookingStatus;
  const releasedForNonPayment = from === 'cancelled' && b.cancelReason === EXPIRED_REASON;
  if (covered && (from === 'pending' || releasedForNonPayment) && (b.autoConfirm || releasedForNonPayment || pay.via === 'manual')) {
    try {
      // Savepoint: reviving a released booking fails if someone else took the slot meanwhile.
      await tx.transaction(async (sp) => {
        await guardOverlap(() =>
          sp
            .update(bookings)
            .set({ status: 'confirmed', confirmedAt: new Date(), expiresAt: null, cancelledAt: null, cancelReason: null })
            .where(eq(bookings.id, bookingId)),
        );
      });
      await recordBookingEvent(tx, {
        businessId,
        bookingId,
        type: 'confirmed',
        actorUserId: pay.actorUserId,
        details: { from, reason: 'paid' },
      });
    } catch (err) {
      if (!(err instanceof AppError) || err.code !== 'slot_taken') throw err;
      if (pay.via === 'toyyibpay') {
        await notifyBooking(tx, outbox, businessId, bookingId, null, { kind: 'paid', amountSen: pay.amountSen, released: true });
      }
      return;
    }
  } else if (covered && from === 'pending') {
    // Paid but the owner confirms by hand: keep it, but stop the unpaid-hold clock.
    await tx.update(bookings).set({ expiresAt: null }).where(eq(bookings.id, bookingId));
  }
  if (pay.via === 'toyyibpay') {
    await notifyBooking(tx, outbox, businessId, bookingId, null, { kind: 'paid', amountSen: pay.amountSen });
  }
}

/** cancel_reason written by the expiry job — lets a late payment revive the booking. */
export const EXPIRED_REASON = 'Not paid in time';

// ---------------------------------------------------------------- views

export async function listBookingPayments(
  q: Q,
  deps: PaymentDeps,
  businessId: number,
  bookingId: number,
): Promise<BookingPayments> {
  const rows = await q
    .select({
      id: payments.id,
      purpose: payments.purpose,
      provider: payments.provider,
      method: payments.method,
      amountSen: payments.amountSen,
      status: payments.status,
      billCode: payments.billCode,
      transactionRef: payments.transactionRef,
      paidAt: payments.paidAt,
      recordedBy: users.name,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .leftJoin(users, eq(users.id, payments.recordedByUserId))
    .where(and(eq(payments.businessId, businessId), eq(payments.bookingId, bookingId)))
    .orderBy(desc(payments.createdAt), desc(payments.id));
  const items: PaymentRecord[] = rows.map((r) => ({
    id: r.id,
    purpose: r.purpose as PaymentPurpose,
    provider: r.provider as PaymentRecord['provider'],
    method: r.method as PaymentMethod | null,
    amountSen: r.amountSen,
    status: r.status as PaymentRecordStatus,
    reference: r.transactionRef ?? r.billCode,
    paidAt: r.paidAt?.toISOString() ?? null,
    recordedBy: r.recordedBy,
    createdAt: r.createdAt.toISOString(),
  }));
  const open = rows.find((r) => r.provider === 'toyyibpay' && r.status === 'pending' && r.billCode);
  return {
    items,
    paidSen: items.filter((i) => i.status === 'paid' || i.status === 'refunded').reduce((s, i) => s + i.amountSen, 0),
    onlineAvailable: await isOnlinePaymentAvailable(q, businessId),
    payLink: open ? { url: deps.toyyibpay.paymentUrl(open.billCode!), createdAt: open.createdAt.toISOString() } : null,
  };
}

/** C4 / F4 · what the customer sees about paying. */
export async function publicPayment(
  q: Q,
  businessId: number,
  bookingId: number,
  b: { status: string; paymentStatus: string; amountDueSen: number },
): Promise<PublicPayment> {
  const [last] = await q
    .select({ status: payments.status, billCode: payments.billCode, ref: payments.transactionRef })
    .from(payments)
    .where(and(eq(payments.businessId, businessId), eq(payments.bookingId, bookingId), eq(payments.provider, 'toyyibpay')))
    .orderBy(desc(payments.id))
    .limit(1);
  const required = b.status === 'pending' && b.paymentStatus === 'unpaid' && b.amountDueSen > 0;
  let status: PublicPayment['status'] = 'not_required';
  if (b.paymentStatus === 'paid') status = 'paid';
  else if (required) status = last?.status === 'failed' ? 'failed' : 'pending';
  return {
    required,
    amountSen: b.amountDueSen,
    status,
    onlineAvailable: await isOnlinePaymentAvailable(q, businessId),
    reference: last ? (last.ref ?? last.billCode) : null,
  };
}

/** Pending ToyyibPay bills of one booking, re-checked (customer came back from the bank). */
export async function syncBookingBills(db: Db, deps: PaymentDeps, bookingId: number, outbox: Outbox): Promise<void> {
  const open = await db
    .select({ billCode: payments.billCode })
    .from(payments)
    .where(
      and(eq(payments.bookingId, bookingId), eq(payments.provider, 'toyyibpay'), inArray(payments.status, ['pending', 'failed', 'expired'])),
    )
    .orderBy(desc(payments.id))
    .limit(3);
  for (const p of open) {
    if (p.billCode) await syncBill(db, deps, p.billCode, outbox).catch(gatewayError);
  }
}

// ---------------------------------------------------------------- H7 · manual payment

/** Cash / DuitNow QR / card / bank transfer received in person (members with can_take_payments). */
export async function recordManualPayment(
  db: Db,
  businessId: number,
  bookingId: number,
  userId: number,
  input: ManualPaymentInput,
  outbox = new Outbox(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const [b] = await tx
      .select({ status: bookings.status, priceSen: bookings.priceSen, amountDueSen: bookings.amountDueSen })
      .from(bookings)
      .where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId)))
      .for('update');
    if (!b) throw notFound('Booking');
    if (b.status === 'cancelled' || b.status === 'no_show') {
      throw new AppError(409, 'booking_closed', 'This booking is cancelled — no payment to record');
    }
    const [sum] = await tx
      .select({ paid: sql<number>`coalesce(sum(${payments.amountSen}), 0)::int` })
      .from(payments)
      .where(and(eq(payments.businessId, businessId), eq(payments.bookingId, bookingId), eq(payments.status, 'paid')));
    const left = Math.max(b.priceSen, b.amountDueSen) - (sum?.paid ?? 0);
    if (input.amountSen > left) {
      throw new AppError(400, 'amount_too_large', `Only ${(left / 100).toFixed(2)} is left to pay`, { maxSen: left });
    }
    await tx.insert(payments).values({
      businessId,
      bookingId,
      purpose: (sum?.paid ?? 0) > 0 ? 'balance' : purposeFor(input.amountSen, b.priceSen),
      provider: 'manual',
      method: input.method,
      recordedByUserId: userId,
      amountSen: input.amountSen,
      status: 'paid',
      paidAt: new Date(),
      transactionRef: input.reference || null,
    });
    // An open online bill for the same booking is no longer needed.
    await tx
      .update(payments)
      .set({ status: 'expired' })
      .where(and(eq(payments.bookingId, bookingId), eq(payments.provider, 'toyyibpay'), eq(payments.status, 'pending')));
    await applyPaymentToBooking(tx, businessId, bookingId, { amountSen: input.amountSen, actorUserId: userId, via: 'manual', method: input.method }, outbox);
  });
}
