import { formatInTimeZone } from 'date-fns-tz';
import { and, desc, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import {
  bookings,
  businesses,
  customers,
  paymentAccounts,
  payments,
  refunds,
  resources,
  services,
  users,
  type Db,
  type Tx,
} from '@outletbooking/db';
import type {
  Booking,
  ManualPaymentMethod,
  PaymentAccountInfo,
  PaymentAccountStatus,
  PaymentLink,
  RecordPaymentInput,
} from '@outletbooking/shared';
import type { Env } from '../env';
import { AppError, notFound, pgErrorInfo } from '../errors';
import { recordBookingEvent } from './booking-events';
import { getBooking, type BookingScope } from './bookings';
import { notify, recipientsFor } from './notifications';
import type { PushSender } from './push';
import { decryptSecret, encryptSecret } from './secrets';
import { callbackHash, ringgitToSen, toyyibText, ToyyibPayError, type ToyyibPayClient } from './toyyibpay';

type Q = Db | Tx;

export interface PaymentDeps {
  db: Db;
  env: Env;
  toyyibpay: ToyyibPayClient;
  push: PushSender;
}

/** Short reference shown to customers and sent to ToyyibPay as order_id (never the integer id). */
export const bookingRef = (token: string) => token.slice(0, 6).toUpperCase();

/** Where ToyyibPay reaches this API (callbacks). A tunnel URL when testing locally. */
export const apiPublicUrl = (env: Env) => (env.API_PUBLIC_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, '');
const appPublicUrl = (env: Env) => env.APP_PUBLIC_URL.replace(/\/+$/, '');

const TEST_AMOUNT_SEN = 100;

// ───────────────────────────────────────────── H1: the business's own ToyyibPay account

async function loadAccount(q: Q, businessId: number) {
  const [row] = await q.select().from(paymentAccounts).where(eq(paymentAccounts.businessId, businessId)).limit(1);
  return row;
}

function toInfo(row: Awaited<ReturnType<typeof loadAccount>>): PaymentAccountInfo {
  if (!row) {
    return {
      status: 'not_connected',
      secretKeyLast4: null,
      categoryCode: null,
      connectedAt: null,
      testedAt: null,
      testPending: false,
      lastError: null,
    };
  }
  return {
    status: row.status as PaymentAccountStatus,
    secretKeyLast4: row.secretKeyLast4,
    categoryCode: row.categoryCode,
    connectedAt: row.status === 'connected' ? row.updatedAt.toISOString() : null,
    testedAt: row.testedAt?.toISOString() ?? null,
    testPending: !!row.testBillCode && !row.testedAt,
    lastError: row.lastError,
  };
}

export async function getPaymentAccount(db: Db, businessId: number): Promise<PaymentAccountInfo> {
  return toInfo(await loadAccount(db, businessId));
}

/** A connected account with its decrypted key, or 409. Never leaves the API. */
async function connectedAccount(q: Q, env: Env, businessId: number) {
  const row = await loadAccount(q, businessId);
  if (!row || row.status !== 'connected' || !row.secretKeyEncrypted || !row.categoryCode) {
    throw new AppError(409, 'payments_not_connected', 'Online payment is not set up for this business yet');
  }
  return { ...row, categoryCode: row.categoryCode, secretKey: decryptSecret(row.secretKeyEncrypted, env.APP_ENCRYPTION_KEY) };
}

async function businessInfo(q: Q, businessId: number) {
  const [biz] = await q
    .select({
      name: businesses.name,
      slug: businesses.slug,
      phone: businesses.phone,
      email: businesses.email,
      timezone: businesses.timezone,
      autoConfirmPaid: businesses.autoConfirmPaid,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId));
  if (!biz) throw notFound('Business');
  return biz;
}

/** ToyyibPay rejected the request (wrong key…) → 400 the owner can act on; anything else → 502. */
function toyyibFailure(err: unknown): AppError {
  if (err instanceof ToyyibPayError) {
    return new AppError(400, 'toyyibpay_rejected', `ToyyibPay did not accept this: ${err.message}`);
  }
  console.error('[toyyibpay]', err);
  return new AppError(502, 'toyyibpay_unavailable', "Couldn't reach ToyyibPay. Please try again in a minute.");
}

/**
 * H1 step 2–3: checks the key by creating the business's payment category, then stores the key
 * encrypted. Reconnecting replaces the key and asks for a new RM 1.00 test.
 */
export async function connectToyyibPay(
  deps: PaymentDeps,
  businessId: number,
  userId: number,
  secretKey: string,
): Promise<PaymentAccountInfo> {
  const encrypted = encryptSecret(secretKey, deps.env.APP_ENCRYPTION_KEY); // fails early when not configured
  const biz = await businessInfo(deps.db, businessId);
  let categoryCode: string;
  try {
    categoryCode = await deps.toyyibpay.createCategory(
      secretKey,
      toyyibText(`OutletBooking ${biz.name}`, 50),
      toyyibText(`Bookings for ${biz.name} via OutletBooking`, 100),
    );
  } catch (err) {
    throw toyyibFailure(err);
  }
  const values = {
    status: 'connected',
    secretKeyEncrypted: encrypted,
    secretKeyLast4: secretKey.slice(-4),
    categoryCode,
    lastError: null,
    testBillCode: null,
    testedAt: null,
    connectedByUserId: userId,
  };
  await deps.db
    .insert(paymentAccounts)
    .values({ businessId, ...values })
    .onConflictDoUpdate({ target: paymentAccounts.businessId, set: values });
  return getPaymentAccount(deps.db, businessId);
}

/** Removes the key. Bookings already paid keep their payment records. */
export async function disconnectToyyibPay(db: Db, businessId: number): Promise<PaymentAccountInfo> {
  await db.delete(paymentAccounts).where(eq(paymentAccounts.businessId, businessId));
  return getPaymentAccount(db, businessId);
}

/** H1 "Run RM 1.00 test payment": a real bill on the business's own account. */
export async function startTestPayment(deps: PaymentDeps, businessId: number, ownerUserId: number): Promise<PaymentLink> {
  const account = await connectedAccount(deps.db, deps.env, businessId);
  const biz = await businessInfo(deps.db, businessId);
  const [owner] = await deps.db.select({ email: users.email, phone: users.phone }).from(users).where(eq(users.id, ownerUserId));
  let billCode: string;
  try {
    billCode = await deps.toyyibpay.createBill({
      userSecretKey: account.secretKey,
      categoryCode: account.categoryCode,
      billName: 'OutletBooking test',
      billDescription: `Test payment for ${biz.name}`,
      amountSen: TEST_AMOUNT_SEN,
      returnUrl: `${apiPublicUrl(deps.env)}/toyyibpay/test-return`,
      callbackUrl: `${apiPublicUrl(deps.env)}/toyyibpay/callback`,
      externalReferenceNo: `TEST-${biz.slug}`.slice(0, 30),
      billTo: biz.name,
      billEmail: owner?.email ?? biz.email ?? '',
      billPhone: (owner?.phone ?? biz.phone ?? '').replace(/\D/g, ''),
    });
  } catch (err) {
    throw toyyibFailure(err);
  }
  await deps.db.update(paymentAccounts).set({ testBillCode: billCode, testedAt: null }).where(eq(paymentAccounts.id, account.id));
  return { paymentUrl: deps.toyyibpay.paymentUrl(billCode), amountSen: TEST_AMOUNT_SEN, expiresAt: null };
}

/** "I've paid — check": asks ToyyibPay whether the test bill was paid. */
export async function checkTestPayment(deps: PaymentDeps, businessId: number): Promise<PaymentAccountInfo> {
  const row = await loadAccount(deps.db, businessId);
  if (row?.testBillCode && !row.testedAt) await syncTestBill(deps, row.id, row.testBillCode);
  return getPaymentAccount(deps.db, businessId);
}

async function syncTestBill(deps: PaymentDeps, accountId: number, billCode: string): Promise<boolean> {
  let txs;
  try {
    txs = await deps.toyyibpay.getBillTransactions(billCode);
  } catch (err) {
    throw toyyibFailure(err);
  }
  const paid = txs.some((t) => t.billpaymentStatus === '1' && ringgitToSen(t.billpaymentAmount) >= TEST_AMOUNT_SEN);
  if (paid) {
    await deps.db
      .update(paymentAccounts)
      .set({ testedAt: new Date() })
      .where(and(eq(paymentAccounts.id, accountId), isNull(paymentAccounts.testedAt)));
  }
  return paid;
}

// ───────────────────────────────────────────── Bills for bookings (deposit / full payment)

async function bookingForPayment(q: Q, where: { businessId: number; bookingId: number } | { token: string }) {
  const [b] = await q
    .select({
      id: bookings.id,
      businessId: bookings.businessId,
      token: bookings.publicToken,
      status: bookings.status,
      startAt: bookings.startAt,
      priceSen: bookings.priceSen,
      amountDueSen: bookings.amountDueSen,
      paymentStatus: bookings.paymentStatus,
      expiresAt: bookings.expiresAt,
      resourceUserId: resources.userId,
      serviceName: services.name,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerEmail: customers.email,
    })
    .from(bookings)
    .innerJoin(services, and(eq(services.businessId, bookings.businessId), eq(services.id, bookings.serviceId)))
    .innerJoin(resources, and(eq(resources.businessId, bookings.businessId), eq(resources.id, bookings.resourceId)))
    .innerJoin(customers, and(eq(customers.businessId, bookings.businessId), eq(customers.id, bookings.customerId)))
    .where(
      'token' in where
        ? eq(bookings.publicToken, where.token)
        : and(eq(bookings.businessId, where.businessId), eq(bookings.id, where.bookingId)),
    );
  if (!b) throw notFound('Booking');
  return b;
}

async function paidAndRefunded(q: Q, businessId: number, bookingId: number) {
  const [paid] = await q
    .select({ n: sql<number>`coalesce(sum(${payments.amountSen}), 0)::int` })
    .from(payments)
    .where(and(eq(payments.businessId, businessId), eq(payments.bookingId, bookingId), eq(payments.status, 'paid')));
  const [refunded] = await q
    .select({ n: sql<number>`coalesce(sum(${refunds.amountSen}), 0)::int` })
    .from(refunds)
    .where(and(eq(refunds.businessId, businessId), eq(refunds.bookingId, bookingId)));
  return { paid: Number(paid?.n ?? 0), refunded: Number(refunded?.n ?? 0) };
}

/**
 * Pay link for the amount due (deposit or full prepayment) on the business's own ToyyibPay.
 * Reuses the open bill for the same amount, so "Try again" and "Resend pay link" don't pile up bills.
 */
export async function createBookingPaymentLink(
  deps: PaymentDeps,
  where: { businessId: number; bookingId: number; scope?: BookingScope } | { token: string },
  opts: { actorUserId?: number; now?: Date } = {},
): Promise<PaymentLink> {
  const now = opts.now ?? new Date();
  const b = await bookingForPayment(deps.db, where);
  if ('scope' in where && where.scope?.linkedUserId !== undefined && b.resourceUserId !== where.scope.linkedUserId) {
    throw notFound('Booking');
  }
  if (b.status !== 'pending' && b.status !== 'confirmed') {
    throw new AppError(409, 'not_payable', 'This booking can no longer be paid');
  }
  if (b.status === 'pending' && b.expiresAt && b.expiresAt <= now) {
    throw new AppError(409, 'hold_expired', 'The time held for this booking has run out. Please book again.');
  }
  const { paid } = await paidAndRefunded(deps.db, b.businessId, b.id);
  const amountSen = b.amountDueSen - paid;
  if (b.amountDueSen <= 0 || amountSen <= 0) throw new AppError(409, 'nothing_to_pay', 'Nothing is due online for this booking');

  const account = await connectedAccount(deps.db, deps.env, b.businessId);
  const expiresAt = b.status === 'pending' ? b.expiresAt : null;
  const link = (billCode: string): PaymentLink => ({
    paymentUrl: deps.toyyibpay.paymentUrl(billCode),
    amountSen,
    expiresAt: expiresAt?.toISOString() ?? null,
  });

  const [open] = await deps.db
    .select({ billCode: payments.billCode })
    .from(payments)
    .where(
      and(
        eq(payments.businessId, b.businessId),
        eq(payments.bookingId, b.id),
        eq(payments.provider, 'toyyibpay'),
        eq(payments.status, 'pending'),
        eq(payments.amountSen, amountSen),
        isNotNull(payments.billCode),
      ),
    )
    .orderBy(desc(payments.id))
    .limit(1);

  let billCode = open?.billCode ?? null;
  if (!billCode) {
    const biz = await businessInfo(deps.db, b.businessId);
    const when = formatInTimeZone(b.startAt, biz.timezone, 'd MMM yyyy h mm a');
    try {
      billCode = await deps.toyyibpay.createBill({
        userSecretKey: account.secretKey,
        categoryCode: account.categoryCode,
        billName: biz.name,
        billDescription: `${b.serviceName} ${when} Ref ${bookingRef(b.token)}`,
        amountSen,
        returnUrl: `${appPublicUrl(deps.env)}/my-booking/${b.token}`,
        callbackUrl: `${apiPublicUrl(deps.env)}/toyyibpay/callback`,
        externalReferenceNo: bookingRef(b.token),
        billTo: b.customerName,
        billEmail: b.customerEmail ?? biz.email ?? '',
        billPhone: (b.customerPhone ?? '').replace(/\D/g, ''),
        expiresAt: expiresAt ?? undefined,
      });
    } catch (err) {
      throw toyyibFailure(err);
    }
    await deps.db.insert(payments).values({
      businessId: b.businessId,
      bookingId: b.id,
      purpose: b.amountDueSen >= b.priceSen ? 'full_payment' : 'deposit',
      provider: 'toyyibpay',
      method: 'fpx',
      billCode,
      amountSen,
      status: 'pending',
    });
  }

  if (opts.actorUserId !== undefined) {
    await deps.db.transaction((tx) =>
      recordBookingEvent(tx, {
        businessId: b.businessId,
        bookingId: b.id,
        type: 'pay_link_sent',
        actorUserId: opts.actorUserId!,
        details: { amountSen },
      }),
    );
  }
  return link(billCode);
}

// ───────────────────────────────────────────── Payment received → booking

export type PaymentOutcome = 'confirmed' | 'paid' | 'reinstated' | 'late_slot_taken';

/**
 * Applies a payment already stored as `paid` to its booking (inside the caller's transaction):
 * payment status, pending → confirmed (unless the business confirms paid bookings by hand),
 * and a booking that expired a moment before the money arrived is put back if its slot is still free.
 */
async function applyPayment(
  tx: Tx,
  businessId: number,
  bookingId: number,
  p: { amountSen: number; method: string; manual: boolean; actorUserId: number | null; ref?: string | null },
): Promise<PaymentOutcome> {
  const [b] = await tx
    .select({
      status: bookings.status,
      priceSen: bookings.priceSen,
      amountDueSen: bookings.amountDueSen,
      paymentStatus: bookings.paymentStatus,
      cancelReason: bookings.cancelReason,
      autoConfirmPaid: businesses.autoConfirmPaid,
    })
    .from(bookings)
    .innerJoin(businesses, eq(businesses.id, bookings.businessId))
    .where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId)))
    .for('update', { of: bookings });
  if (!b) throw notFound('Booking');

  const { paid } = await paidAndRefunded(tx, businessId, bookingId);
  const fullyDue = b.amountDueSen > 0 ? paid >= b.amountDueSen : paid >= b.priceSen;
  const paymentStatus = fullyDue && b.paymentStatus !== 'refunded' ? 'paid' : b.paymentStatus;
  await recordBookingEvent(tx, {
    businessId,
    bookingId,
    type: 'paid',
    actorUserId: p.actorUserId,
    details: { amountSen: p.amountSen, method: p.method, ...(p.manual ? { manual: true } : {}), ...(p.ref ? { ref: p.ref } : {}) },
  });

  const now = new Date();
  if (b.status === 'pending' && fullyDue && (b.autoConfirmPaid || p.manual)) {
    await tx
      .update(bookings)
      .set({ paymentStatus, status: 'confirmed', confirmedAt: now, expiresAt: null })
      .where(eq(bookings.id, bookingId));
    await recordBookingEvent(tx, { businessId, bookingId, type: 'confirmed', actorUserId: p.actorUserId, details: { by: 'payment' } });
    return 'confirmed';
  }
  if (b.status === 'cancelled' && b.cancelReason === PAYMENT_TIMEOUT) {
    // Paid just after the hold ran out: take the slot back if nobody else has it.
    try {
      await tx.transaction((sp) =>
        sp
          .update(bookings)
          .set({ paymentStatus, status: 'confirmed', confirmedAt: now, cancelledAt: null, cancelReason: null, expiresAt: null })
          .where(eq(bookings.id, bookingId)),
      );
      await recordBookingEvent(tx, { businessId, bookingId, type: 'confirmed', actorUserId: null, details: { by: 'late_payment' } });
      return 'reinstated';
    } catch (err) {
      if (pgErrorInfo(err).code !== '23P01') throw err;
      await tx.update(bookings).set({ paymentStatus }).where(eq(bookings.id, bookingId));
      return 'late_slot_taken';
    }
  }
  await tx
    .update(bookings)
    .set({ paymentStatus, ...(b.status === 'pending' ? { expiresAt: null } : {}) })
    .where(eq(bookings.id, bookingId));
  return 'paid';
}

export interface BillSyncResult {
  businessId: number;
  bookingId: number;
  outcome: PaymentOutcome;
  amountSen: number;
}

/**
 * The only way an online payment becomes `paid`: ask ToyyibPay (getBillTransactions) — never trust
 * the callback body alone. Idempotent: a bill already marked paid returns null.
 */
export async function syncBill(deps: PaymentDeps, billCode: string, raw?: Record<string, string>): Promise<BillSyncResult | null> {
  const [payment] = await deps.db
    .select({ id: payments.id, status: payments.status, bookingId: payments.bookingId })
    .from(payments)
    .where(eq(payments.billCode, billCode))
    .limit(1);
  if (!payment) {
    const [account] = await deps.db
      .select({ id: paymentAccounts.id })
      .from(paymentAccounts)
      .where(eq(paymentAccounts.testBillCode, billCode))
      .limit(1);
    if (account) await syncTestBill(deps, account.id, billCode);
    return null;
  }
  if (payment.status === 'paid' || !payment.bookingId) return null;

  const txs = await deps.toyyibpay.getBillTransactions(billCode);
  const ok = txs.find((t) => t.billpaymentStatus === '1');
  if (!ok) return null;

  return deps.db.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        id: payments.id,
        status: payments.status,
        businessId: payments.businessId,
        bookingId: payments.bookingId,
        amountSen: payments.amountSen,
      })
      .from(payments)
      .where(eq(payments.id, payment.id))
      .for('update');
    if (!locked || locked.status === 'paid' || !locked.bookingId) return null;
    if (ringgitToSen(ok.billpaymentAmount) < locked.amountSen) {
      console.warn(`[toyyibpay] bill ${billCode}: paid ${ok.billpaymentAmount}, expected ${locked.amountSen} sen — not marked paid`);
      return null;
    }
    await tx
      .update(payments)
      .set({
        status: 'paid',
        method: ok.billpaymentChannel?.toLowerCase().includes('duitnow') ? 'duitnow_qr' : 'fpx',
        transactionRef: ok.billpaymentInvoiceNo || raw?.refno || null,
        paidAt: new Date(),
        rawCallback: raw ?? null,
      })
      .where(eq(payments.id, locked.id));
    const outcome = await applyPayment(tx, locked.businessId, locked.bookingId, {
      amountSen: locked.amountSen,
      method: 'fpx',
      manual: false,
      actorUserId: null,
      ref: ok.billpaymentInvoiceNo,
    });
    return { businessId: locked.businessId, bookingId: locked.bookingId, outcome, amountSen: locked.amountSen };
  });
}

/**
 * ToyyibPay callback (form POST). The hash is checked for logging only; what counts is the
 * re-check in `syncBill`, which a forged callback cannot fake.
 */
export async function handleToyyibPayCallback(deps: PaymentDeps, form: Record<string, string>): Promise<BillSyncResult | null> {
  const billCode = form.billcode;
  if (!billCode) return null;
  if (form.hash) {
    const [row] = await deps.db
      .select({ key: paymentAccounts.secretKeyEncrypted })
      .from(payments)
      .innerJoin(paymentAccounts, eq(paymentAccounts.businessId, payments.businessId))
      .where(eq(payments.billCode, billCode))
      .limit(1);
    if (row?.key) {
      const expected = callbackHash(decryptSecret(row.key, deps.env.APP_ENCRYPTION_KEY), form.status ?? '', form.order_id ?? '', form.refno ?? '');
      if (expected !== form.hash) console.warn(`[toyyibpay] callback hash mismatch for bill ${billCode}; re-checking with ToyyibPay`);
    }
  }
  return syncBill(deps, billCode, form);
}

/** Customer came back from ToyyibPay (return URL) or tapped "I've paid": re-check their latest bill. */
export async function syncBookingBills(deps: PaymentDeps, bookingId: number): Promise<BillSyncResult | null> {
  const open = await deps.db
    .select({ billCode: payments.billCode })
    .from(payments)
    .where(and(eq(payments.bookingId, bookingId), eq(payments.status, 'pending'), isNotNull(payments.billCode)))
    .orderBy(desc(payments.id))
    .limit(3);
  for (const { billCode } of open) {
    try {
      const r = await syncBill(deps, billCode!);
      if (r) return r;
    } catch (err) {
      console.error('[toyyibpay] re-check failed', err);
    }
  }
  return null;
}

/** D6 / push after a payment: "New booking · paid RM 60", or a refund warning for late payments. */
export async function notifyPayment(deps: PaymentDeps, r: BillSyncResult): Promise<void> {
  const [b] = await deps.db
    .select({
      startAt: bookings.startAt,
      timezone: businesses.timezone,
      serviceName: services.name,
      resourceName: resources.name,
      resourceUserId: resources.userId,
      customerName: customers.name,
    })
    .from(bookings)
    .innerJoin(businesses, eq(businesses.id, bookings.businessId))
    .innerJoin(services, and(eq(services.businessId, bookings.businessId), eq(services.id, bookings.serviceId)))
    .innerJoin(resources, and(eq(resources.businessId, bookings.businessId), eq(resources.id, bookings.resourceId)))
    .innerJoin(customers, and(eq(customers.businessId, bookings.businessId), eq(customers.id, bookings.customerId)))
    .where(and(eq(bookings.businessId, r.businessId), eq(bookings.id, r.bookingId)));
  if (!b) return;
  const when = formatInTimeZone(b.startAt, b.timezone, 'EEE d MMM, h:mm a');
  const amount = `RM ${(r.amountSen / 100).toFixed(2)}`;
  const late = r.outcome === 'late_slot_taken';
  await notify(deps.db, deps.push, await recipientsFor(deps.db, r.businessId, b.resourceUserId), {
    businessId: r.businessId,
    type: late ? 'payment_failed' : 'booking_paid',
    title: late ? `Paid ${amount} after the hold ended — please refund` : `Booking paid · ${amount}`,
    body: `${b.customerName} · ${b.serviceName} · ${when} · ${b.resourceName}${late ? ' · slot was taken' : ''}`,
    bookingId: r.bookingId,
  });
}

// ───────────────────────────────────────────── H7 / S2: payments recorded by hand

const PURPOSE = (paidBefore: number, amountSen: number, b: { priceSen: number; amountDueSen: number }) =>
  paidBefore === 0 && amountSen >= b.priceSen
    ? 'full_payment'
    : paidBefore === 0 && b.amountDueSen > 0 && amountSen < b.priceSen
      ? 'deposit'
      : 'balance';

export async function recordManualPayment(
  db: Db,
  businessId: number,
  bookingId: number,
  input: RecordPaymentInput,
  actor: { userId: number; scope: BookingScope },
): Promise<Booking> {
  return db.transaction(async (tx) => {
    const [b] = await tx
      .select({
        status: bookings.status,
        priceSen: bookings.priceSen,
        amountDueSen: bookings.amountDueSen,
        resourceUserId: resources.userId,
      })
      .from(bookings)
      .innerJoin(resources, and(eq(resources.businessId, bookings.businessId), eq(resources.id, bookings.resourceId)))
      .where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId)))
      .for('update', { of: bookings });
    if (!b || (actor.scope.linkedUserId !== undefined && b.resourceUserId !== actor.scope.linkedUserId)) throw notFound('Booking');
    if (b.status === 'cancelled' || b.status === 'no_show') {
      throw new AppError(409, 'not_payable', 'Payments cannot be recorded on a cancelled booking');
    }
    const { paid, refunded } = await paidAndRefunded(tx, businessId, bookingId);
    const balance = b.priceSen - (paid - refunded);
    if (balance <= 0) throw new AppError(409, 'nothing_to_pay', 'This booking is already fully paid');
    if (input.amountSen > balance) {
      throw new AppError(400, 'payment_too_large', `At most RM ${(balance / 100).toFixed(2)} is still due`);
    }
    await tx.insert(payments).values({
      businessId,
      bookingId,
      purpose: PURPOSE(paid, input.amountSen, b),
      provider: 'manual',
      method: input.method satisfies ManualPaymentMethod,
      recordedByUserId: actor.userId,
      amountSen: input.amountSen,
      status: 'paid',
      transactionRef: input.reference ?? null,
      paidAt: new Date(),
    });
    await applyPayment(tx, businessId, bookingId, {
      amountSen: input.amountSen,
      method: input.method,
      manual: true,
      actorUserId: actor.userId,
      ref: input.reference,
    });
    return getBooking(tx, businessId, bookingId, actor.scope);
  });
}

// ───────────────────────────────────────────── Pending-payment expiry (pg-boss job, BR-04)

export const PAYMENT_TIMEOUT = 'payment_timeout';

/**
 * Unpaid pending bookings past their hold → cancelled (reason payment_timeout), slot freed,
 * open bills marked expired. A bill paid at the last second is caught by re-checking it first.
 */
export async function expirePendingBookings(deps: PaymentDeps, now = new Date()): Promise<number[]> {
  const due = await deps.db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.status, 'pending'), eq(bookings.paymentStatus, 'unpaid'), lte(bookings.expiresAt, now)))
    .limit(200);
  const expired: number[] = [];
  for (const { id } of due) {
    const synced = await syncBookingBills(deps, id);
    if (synced) {
      void notifyPayment(deps, synced).catch((err: unknown) => console.error('[payments] notify failed', err));
      continue;
    }
    const done = await deps.db.transaction(async (tx) => {
      const [b] = await tx
        .select({ businessId: bookings.businessId, status: bookings.status, paymentStatus: bookings.paymentStatus, expiresAt: bookings.expiresAt })
        .from(bookings)
        .where(eq(bookings.id, id))
        .for('update', { skipLocked: true });
      if (!b || b.status !== 'pending' || b.paymentStatus !== 'unpaid' || !b.expiresAt || b.expiresAt > now) return false;
      await tx
        .update(bookings)
        .set({ status: 'cancelled', cancelledAt: now, cancelReason: PAYMENT_TIMEOUT })
        .where(eq(bookings.id, id));
      await tx
        .update(payments)
        .set({ status: 'expired' })
        .where(and(eq(payments.bookingId, id), eq(payments.status, 'pending')));
      await recordBookingEvent(tx, { businessId: b.businessId, bookingId: id, type: 'expired', actorUserId: null });
      return true;
    });
    if (done) expired.push(id);
  }
  return expired;
}

/** D6 "Payment not completed · slot released" for each expired booking. */
export async function notifyExpired(deps: PaymentDeps, bookingId: number): Promise<void> {
  const [b] = await deps.db
    .select({
      businessId: bookings.businessId,
      startAt: bookings.startAt,
      timezone: businesses.timezone,
      serviceName: services.name,
      resourceName: resources.name,
      resourceUserId: resources.userId,
      customerName: customers.name,
    })
    .from(bookings)
    .innerJoin(businesses, eq(businesses.id, bookings.businessId))
    .innerJoin(services, and(eq(services.businessId, bookings.businessId), eq(services.id, bookings.serviceId)))
    .innerJoin(resources, and(eq(resources.businessId, bookings.businessId), eq(resources.id, bookings.resourceId)))
    .innerJoin(customers, and(eq(customers.businessId, bookings.businessId), eq(customers.id, bookings.customerId)))
    .where(eq(bookings.id, bookingId));
  if (!b) return;
  const when = formatInTimeZone(b.startAt, b.timezone, 'EEE d MMM, h:mm a');
  await notify(deps.db, deps.push, await recipientsFor(deps.db, b.businessId, b.resourceUserId), {
    businessId: b.businessId,
    type: 'payment_failed',
    title: 'Payment not completed',
    body: `${b.customerName} · ${b.serviceName} · ${when} · slot released`,
    bookingId,
  });
}
