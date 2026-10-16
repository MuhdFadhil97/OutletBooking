import { randomBytes } from 'node:crypto';
import { addMonths } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  billingDetails,
  businesses,
  businessMembers,
  payments,
  platformAdmins,
  subscriptions,
  users,
  type Db,
  type Tx,
} from '@outletbooking/db';
import {
  BILLING_ERRORS,
  checkoutSchema,
  formatReceiptNo,
  PAID_PLANS,
  planEntryMonthlySen,
  receiptDetailsSchema,
  type BillingHistory,
  type BillingOverview,
  type BillingPayment,
  type CheckoutInput,
  type CheckoutResult,
  type PaidPlan,
  type PlanCatalogEntry,
  type PlanPaymentStatus,
  type PlanQuote,
  type ReceiptDetails,
  type ReceiptDetailsInput,
  type WebLinkPage,
} from '@outletbooking/shared';
import type { Auth } from '../auth';
import type { Env } from '../env';
import { AppError, notFound } from '../errors';
import { periodText, receiptEmail } from './billing-emails';
import { sendConfirmEmail } from './confirm-email';
import type { Mailer } from './mailer';
import { apiPublicUrl } from './payments';
import { getPlanCatalog } from './plan-catalog';
import { getPlanInfo } from './plan';
import { renderReceiptPdf } from './receipt-pdf';
import { ringgitToSen, toyyibText, ToyyibPayError, type ToyyibPayClient } from './toyyibpay';
import { takeHandoffLink } from './web-links';

/**
 * Plan payment on the website: FTech's own ToyyibPay account (never a business's key), one month at a time.
 * A payment only becomes `paid` after ToyyibPay itself confirms it (re-check), and then the plan period,
 * the receipt number and the receipt snapshot are written in one transaction.
 */

const TZ = 'Asia/Kuala_Lumpur';

export interface BillingDeps {
  db: Db;
  env: Env;
  toyyibpay: ToyyibPayClient;
  mailer: Mailer;
  auth: Auth;
}

const platformKeys = (env: Env) =>
  env.PLATFORM_TOYYIBPAY_SECRET_KEY && env.PLATFORM_TOYYIBPAY_CATEGORY_CODE
    ? { secretKey: env.PLATFORM_TOYYIBPAY_SECRET_KEY, categoryCode: env.PLATFORM_TOYYIBPAY_CATEGORY_CODE }
    : null;

const website = (env: Env) => env.WEBSITE_URL.replace(/\/+$/, '');

// ------------------------------------------------------------ plan period

export interface PlanPeriod {
  start: Date;
  /** The instant the month ends (start + 1 calendar month, Malaysia time). */
  end: Date;
}

/**
 * Where the next paid month starts: when the trial ends, or when the paid time already bought runs out;
 * otherwise now (an ended trial or lapsed plan). Months are calendar months in Malaysia time
 * (31 Jan + 1 month = 28 Feb), as in I2 free months.
 */
export function nextPlanPeriod(
  sub: { status: string; trialEndsAt: Date; currentPeriodEnd: Date | null } | null,
  now: Date = new Date(),
): PlanPeriod {
  let start = now;
  if (sub) {
    const paidUntil = sub.status !== 'trialing' && sub.currentPeriodEnd && sub.currentPeriodEnd > now ? sub.currentPeriodEnd : null;
    const trialUntil = sub.status === 'trialing' && sub.trialEndsAt > now ? sub.trialEndsAt : null;
    start = paidUntil ?? trialUntil ?? now;
  }
  return { start, end: fromZonedTime(addMonths(toZonedTime(start, TZ), 1), TZ) };
}

// ------------------------------------------------------------ overview and receipt details

const methodLabel = (m: string | null) => (m === 'bank_transfer' ? 'Bank transfer' : m === 'duitnow_qr' ? 'DuitNow QR' : m === 'fpx' ? 'FPX' : (m ?? 'ToyyibPay'));

export interface PlanReceiptSnapshot {
  companyName?: string;
  ssmNo?: string | null;
  tin?: string | null;
  address?: string | null;
  receiptEmail?: string;
  plan?: PaidPlan;
  planName?: string;
  periodStart?: string;
  periodEnd?: string;
  description?: string;
}

function toQuote(plan: PlanCatalogEntry, resourceCount: number): PlanQuote {
  const extraResources = Math.max(0, resourceCount - plan.resourceLimit);
  return {
    plan: plan.code,
    totalSen: planEntryMonthlySen(plan, resourceCount),
    baseSen: plan.priceSen,
    extraResources,
    extraSen: extraResources * plan.extraResourceSen,
  };
}

async function loadDetails(db: Db | Tx, businessId: number, fallback: { name: string; email: string }) {
  const [row] = await db.select().from(billingDetails).where(eq(billingDetails.businessId, businessId)).limit(1);
  return {
    saved: !!row,
    details: {
      companyName: row?.companyName ?? fallback.name,
      ssmNo: row?.ssmNo ?? null,
      tin: row?.tin ?? null,
      address: row?.address ?? null,
      receiptEmail: row?.receiptEmail ?? fallback.email,
    },
  };
}

async function ownerFacts(db: Db, businessId: number, userId: number) {
  const [row] = await db
    .select({
      businessName: businesses.name,
      slug: businesses.slug,
      resourceLabel: businesses.resourceLabel,
      email: users.email,
    })
    .from(businesses)
    .innerJoin(users, eq(users.id, userId))
    .where(and(eq(businesses.id, businessId), isNull(businesses.deletedAt)))
    .limit(1);
  if (!row) throw notFound('Business');
  return row;
}

/** GET /billing/overview: everything the pay page (I4) needs. */
export async function getBillingOverview(deps: BillingDeps, businessId: number, userId: number, now = new Date()): Promise<BillingOverview> {
  const [facts, info, catalog] = await Promise.all([
    ownerFacts(deps.db, businessId, userId),
    getPlanInfo(deps.db, businessId, website(deps.env), now),
    getPlanCatalog(deps.db),
  ]);
  const { saved, details } = await loadDetails(deps.db, businessId, { name: facts.businessName, email: facts.email });
  const [sub] = await deps.db.select().from(subscriptions).where(eq(subscriptions.businessId, businessId)).limit(1);
  const current = info.plan === 'trial' ? null : info.plan;
  const plans = catalog.plans.filter((p) => p.isPublic || p.code === current);
  return {
    signedInAs: facts.email,
    business: { name: facts.businessName, slug: facts.slug },
    subscription: {
      plan: info.plan,
      status: info.status,
      trialEndsAt: info.trialEndsAt,
      currentPeriodEnd: info.currentPeriodEnd,
      freeUntil: info.freeUntil,
      hasAccess: info.hasAccess,
    },
    resourceCount: info.resourceCount,
    resourceLabel: facts.resourceLabel,
    staffCount: info.staffCount,
    recommended: info.recommended,
    plans,
    quotes: Object.fromEntries(catalog.plans.map((p) => [p.code, toQuote(p, info.resourceCount)])) as Record<PaidPlan, PlanQuote>,
    nextPeriodStart: nextPlanPeriod(sub ?? null, now).start.toISOString(),
    details,
    detailsSaved: saved,
    onlinePaymentAvailable: platformKeys(deps.env) !== null,
  };
}

const parseDetails = (raw: ReceiptDetailsInput): ReceiptDetails => {
  const parsed = receiptDetailsSchema.safeParse(raw);
  if (!parsed.success) throw new AppError(400, 'validation_error', parsed.error.issues[0]?.message ?? 'Check the receipt details');
  return parsed.data;
};

/** Saves the receipt details. Receipts already issued keep their own copy. */
export async function saveReceiptDetails(db: Db | Tx, businessId: number, raw: ReceiptDetailsInput): Promise<ReceiptDetails> {
  const d = parseDetails(raw);
  const values = {
    companyName: d.companyName,
    ssmNo: d.ssmNo ?? null,
    tin: d.tin ?? null,
    address: d.address ?? null,
    receiptEmail: d.receiptEmail,
  };
  await db
    .insert(billingDetails)
    .values({ businessId, ...values })
    .onConflictDoUpdate({ target: billingDetails.businessId, set: values });
  return d;
}

// ------------------------------------------------------------ checkout

/** I4 "Pay": a pending plan payment and a ToyyibPay bill on FTech's account. The browser then goes to `paymentUrl`. */
export async function createCheckout(
  deps: BillingDeps,
  businessId: number,
  userId: number,
  raw: CheckoutInput,
  now = new Date(),
): Promise<CheckoutResult> {
  const keys = platformKeys(deps.env);
  if (!keys) {
    throw new AppError(503, BILLING_ERRORS.notConfigured, 'Online payment is not available yet. Please contact us and we will help you pay.');
  }
  const input = (() => {
    const parsed = checkoutSchema.safeParse(raw);
    if (!parsed.success) throw new AppError(400, 'validation_error', parsed.error.issues[0]?.message ?? 'Check your choice');
    return parsed.data;
  })();

  const [facts, info, catalog] = await Promise.all([
    ownerFacts(deps.db, businessId, userId),
    getPlanInfo(deps.db, businessId, website(deps.env), now),
    getPlanCatalog(deps.db),
  ]);
  const plan = catalog.plans.find((p) => p.code === input.plan && (p.isPublic || p.code === info.plan));
  if (!plan) throw new AppError(400, 'unknown_plan', 'That plan is not available');
  const amountSen = planEntryMonthlySen(plan, info.resourceCount);

  const [sub] = await deps.db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.businessId, businessId)).limit(1);
  if (!sub) throw notFound('Subscription');
  const details = await saveReceiptDetails(deps.db, businessId, input.details);

  const [owner] = await deps.db.select({ phone: users.phone }).from(users).where(eq(users.id, userId));
  const reference = `OBP_${randomBytes(4).toString('hex').toUpperCase()}`;
  let billCode: string;
  try {
    billCode = await deps.toyyibpay.createBill({
      userSecretKey: keys.secretKey,
      categoryCode: keys.categoryCode,
      billName: toyyibText(`OutletBooking ${plan.name} plan`, 30),
      billDescription: toyyibText(`${plan.name} plan 1 month for ${facts.businessName}`, 100),
      amountSen,
      returnUrl: `${website(deps.env)}/billing/result`,
      callbackUrl: `${apiPublicUrl(deps.env)}/toyyibpay/plan-callback`,
      externalReferenceNo: reference,
      billTo: toyyibText(details.companyName, 100) || toyyibText(facts.businessName, 100),
      billEmail: details.receiptEmail,
      billPhone: (owner?.phone ?? '').replace(/\D/g, ''),
    });
  } catch (err) {
    if (err instanceof ToyyibPayError) {
      console.error('[billing] ToyyibPay refused the plan bill:', err.message);
      throw new AppError(502, 'payment_provider_error', 'The payment service did not accept this. Please try again in a moment.');
    }
    throw err;
  }

  const snapshot: PlanReceiptSnapshot = {
    companyName: details.companyName,
    ssmNo: details.ssmNo ?? null,
    tin: details.tin ?? null,
    address: details.address ?? null,
    receiptEmail: details.receiptEmail,
    plan: plan.code,
    planName: plan.name,
  };
  await deps.db.insert(payments).values({
    businessId,
    subscriptionId: sub.id,
    purpose: 'subscription',
    provider: 'toyyibpay',
    billCode,
    amountSen,
    status: 'pending',
    receiptSnapshot: snapshot,
  });
  return { ref: billCode, paymentUrl: deps.toyyibpay.paymentUrl(billCode) };
}

// ------------------------------------------------------------ payment sync (the only way a plan payment becomes paid)

type PaymentRow = typeof payments.$inferSelect;

function toBillingPayment(p: PaymentRow): BillingPayment {
  const snap = (p.receiptSnapshot ?? {}) as PlanReceiptSnapshot;
  return {
    ref: p.billCode ?? '',
    status: p.status as PlanPaymentStatus,
    plan: snap.plan ?? null,
    description: snap.description ?? (snap.planName ? `${snap.planName} plan` : 'Plan'),
    amountSen: p.amountSen,
    method: p.method,
    transactionRef: p.transactionRef,
    receiptNo: p.receiptNo,
    paidAt: p.paidAt?.toISOString() ?? null,
    periodStart: snap.periodStart ?? null,
    periodEnd: snap.periodEnd ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

/**
 * One paid month on the subscription, whoever paid (ToyyibPay here, a recorded bank transfer in I8): works out the
 * period, takes the next receipt number and writes plan, status, period and resource limit.
 * Call inside the payment's transaction with the subscription row locked.
 */
export async function applyPaidMonth(
  tx: Tx,
  sub: { id: number; status: string; trialEndsAt: Date; currentPeriodEnd: Date | null },
  plan: PlanCatalogEntry,
  businessId: number,
  now: Date,
): Promise<{ period: PlanPeriod; receiptNo: string; description: string }> {
  const period = nextPlanPeriod(sub, now);
  const [res] = await tx.execute<{ n: string }>(sql`select nextval('receipt_no_seq')::text as n`);
  const receiptNo = formatReceiptNo(Number(formatInTimeZone(now, TZ, 'yyyy')), Number(res!.n));
  const description = `${plan.name} plan · ${periodText(period.start, period.end)}`;
  const [resourceRow] = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from resources where business_id = ${businessId} and deleted_at is null and is_active`,
  );
  await tx
    .update(subscriptions)
    .set({
      plan: plan.code,
      status: 'active',
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      // Resources the business already has stay bookable; each one above the limit is billed as an extra.
      resourceLimit: Math.max(plan.resourceLimit, resourceRow?.n ?? 0),
    })
    .where(eq(subscriptions.id, sub.id));
  return { period, receiptNo, description };
}

export interface PlanSyncResult {
  payment: BillingPayment;
  /** True only for the call that made the payment paid (send the receipt once). */
  justPaid: boolean;
}

/**
 * Ask ToyyibPay about a plan bill and update our record. Never trusts the callback or return URL alone.
 * Safe to call any number of times (callback, return page, retries): a paid payment is never applied twice.
 * With `businessId`, only that business's payment is touched (the return page); the callback passes none.
 */
export async function syncPlanPayment(
  deps: BillingDeps,
  billCode: string,
  opts: { businessId?: number; raw?: Record<string, string>; now?: Date } = {},
): Promise<PlanSyncResult | null> {
  const now = opts.now ?? new Date();
  const [found] = await deps.db
    .select()
    .from(payments)
    .where(and(eq(payments.billCode, billCode), eq(payments.purpose, 'subscription')))
    .limit(1);
  if (!found || (opts.businessId !== undefined && found.businessId !== opts.businessId)) return null;
  if (found.status === 'paid' || found.status === 'refunded') return { payment: toBillingPayment(found), justPaid: false };

  let txs;
  try {
    txs = await deps.toyyibpay.getBillTransactions(billCode);
  } catch (err) {
    console.error('[billing] ToyyibPay re-check failed', err);
    return { payment: toBillingPayment(found), justPaid: false };
  }
  const ok = txs.find((t) => t.billpaymentStatus === '1');
  if (!ok) {
    // Declined, and nothing paid since: tell the owner. A later successful retry on the same bill still counts.
    const declined = txs.some((t) => t.billpaymentStatus === '3');
    if (declined && found.status === 'pending') {
      const [updated] = await deps.db.update(payments).set({ status: 'failed' }).where(eq(payments.id, found.id)).returning();
      return { payment: toBillingPayment(updated ?? found), justPaid: false };
    }
    return { payment: toBillingPayment(found), justPaid: false };
  }
  if (ringgitToSen(ok.billpaymentAmount) < found.amountSen) {
    console.warn(`[billing] bill ${billCode}: paid ${ok.billpaymentAmount}, expected ${found.amountSen} sen — not marked paid`);
    return { payment: toBillingPayment(found), justPaid: false };
  }

  return deps.db.transaction(async (tx) => {
    const [locked] = await tx.select().from(payments).where(eq(payments.id, found.id)).for('update');
    if (!locked) return null;
    if (locked.status === 'paid' || locked.status === 'refunded') return { payment: toBillingPayment(locked), justPaid: false };

    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.id, locked.subscriptionId!)).for('update');
    if (!sub) throw notFound('Subscription');
    const snap = (locked.receiptSnapshot ?? {}) as PlanReceiptSnapshot;
    const catalog = await getPlanCatalog(tx);
    const plan = catalog.plans.find((p) => p.code === snap.plan);
    if (!plan) throw new AppError(500, 'unknown_plan', 'The plan on this payment no longer exists');

    const { period, receiptNo, description } = await applyPaidMonth(tx, sub, plan, locked.businessId, now);
    const method = ok.billpaymentChannel?.toLowerCase().includes('duitnow') ? 'duitnow_qr' : 'fpx';

    const [updated] = await tx
      .update(payments)
      .set({
        status: 'paid',
        method,
        transactionRef: ok.billpaymentInvoiceNo || opts.raw?.refno || null,
        paidAt: now,
        rawCallback: opts.raw ?? null,
        receiptNo,
        receiptSnapshot: {
          ...snap,
          periodStart: period.start.toISOString(),
          periodEnd: period.end.toISOString(),
          description,
        } satisfies PlanReceiptSnapshot,
      })
      .where(eq(payments.id, locked.id))
      .returning();
    return { payment: toBillingPayment(updated!), justPaid: true };
  });
}

/** ToyyibPay's server call after a plan payment (form POST). The hash is only logged; the re-check decides. */
export async function handlePlanCallback(deps: BillingDeps, form: Record<string, string>): Promise<PlanSyncResult | null> {
  const billCode = form.billcode;
  if (!billCode) return null;
  return syncPlanPayment(deps, billCode, { raw: form });
}

// ------------------------------------------------------------ receipts

/** Email the receipt (PDF attached) to the receipt address saved with the payment. */
export async function sendReceiptEmail(deps: Pick<BillingDeps, 'db' | 'env' | 'mailer'>, billCode: string): Promise<void> {
  const [p] = await deps.db
    .select()
    .from(payments)
    .where(and(eq(payments.billCode, billCode), eq(payments.purpose, 'subscription'), eq(payments.status, 'paid')))
    .limit(1);
  if (!p || !p.receiptNo || !p.paidAt) return;
  const snap = (p.receiptSnapshot ?? {}) as PlanReceiptSnapshot;
  if (!snap.receiptEmail) return;
  const pdf = await renderReceiptPdf(receiptPdfInput(p, snap));
  const email = receiptEmail({
    receiptNo: p.receiptNo,
    planName: snap.planName ?? 'OutletBooking',
    period: snap.periodStart && snap.periodEnd ? periodText(new Date(snap.periodStart), new Date(snap.periodEnd)) : '',
    amountSen: p.amountSen,
    billedTo: snap.companyName ?? '',
    ssmNo: snap.ssmNo ?? null,
    tin: snap.tin ?? null,
    accountUrl: `${website(deps.env)}/billing/account`,
    websiteUrl: website(deps.env),
  });
  await deps.mailer.send({
    to: snap.receiptEmail,
    ...email,
    attachments: [{ filename: `${p.receiptNo}.pdf`, content: pdf }],
  });
}

export function receiptPdfInput(p: PaymentRow, snap: PlanReceiptSnapshot) {
  return {
    receiptNo: p.receiptNo!,
    paidAt: p.paidAt!,
    companyName: snap.companyName ?? '',
    ssmNo: snap.ssmNo ?? null,
    tin: snap.tin ?? null,
    address: snap.address ?? null,
    description: snap.description ?? `${snap.planName ?? 'OutletBooking'} plan`,
    amountSen: p.amountSen,
    method: methodLabel(p.method),
    transactionRef: p.transactionRef,
  };
}

/** PDF of one paid plan payment of THIS business (a payment of another business is "not found"). */
export async function getReceiptPdf(db: Db, businessId: number, billCode: string): Promise<{ filename: string; pdf: Buffer }> {
  const [p] = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.businessId, businessId),
        eq(payments.billCode, billCode),
        eq(payments.purpose, 'subscription'),
        inArray(payments.status, ['paid', 'refunded']),
      ),
    )
    .limit(1);
  if (!p || !p.receiptNo || !p.paidAt) throw new AppError(404, BILLING_ERRORS.notFound, 'Receipt not found');
  const snap = (p.receiptSnapshot ?? {}) as PlanReceiptSnapshot;
  return { filename: `${p.receiptNo}.pdf`, pdf: await renderReceiptPdf(receiptPdfInput(p, snap)) };
}

// ------------------------------------------------------------ history and one payment

/** One payment of THIS business, for the result pages. A pending one is re-checked with ToyyibPay first. */
export async function getBillingPayment(deps: BillingDeps, businessId: number, billCode: string): Promise<PlanSyncResult> {
  const synced = await syncPlanPayment(deps, billCode, { businessId });
  if (!synced) throw new AppError(404, BILLING_ERRORS.notFound, 'Payment not found');
  return synced;
}

/** I17: paid and refunded plan payments, newest first, plus the free trial row and the receipt details. */
export async function getBillingHistory(deps: BillingDeps, businessId: number, userId: number, now = new Date()): Promise<BillingHistory> {
  const overview = await getBillingOverview(deps, businessId, userId, now);
  const rows = await deps.db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.businessId, businessId),
        eq(payments.purpose, 'subscription'),
        inArray(payments.status, ['paid', 'refunded']),
      ),
    )
    .orderBy(desc(payments.paidAt), desc(payments.id));
  const [sub] = await deps.db
    .select({ createdAt: subscriptions.createdAt, trialEndsAt: subscriptions.trialEndsAt })
    .from(subscriptions)
    .where(eq(subscriptions.businessId, businessId))
    .limit(1);
  return {
    payments: rows.map(toBillingPayment),
    trial: sub ? { start: sub.createdAt.toISOString(), end: sub.trialEndsAt.toISOString() } : null,
    subscription: overview.subscription,
    plans: overview.plans,
    resourceCount: overview.resourceCount,
    resourceLabel: overview.resourceLabel,
    details: overview.details,
    detailsSaved: overview.detailsSaved,
    signedInAs: overview.signedInAs,
    businessName: overview.business.name,
  };
}

// ------------------------------------------------------------ sign-in links (I13) and the app handoff

/** Per email address, whatever the account: one link a minute. The same answer is given either way. */
const lastLinkAt = new Map<string, number>();
const LINK_COOLDOWN_MS = 60_000;

/** For tests. */
export function resetWebSignInCooldowns(): void {
  lastLinkAt.clear();
}

/** The owner login for this email (an owner of a live business; never a platform admin), or null. */
async function findOwnerUser(db: Db, email: string): Promise<{ userId: number; email: string; confirmed: boolean } | null> {
  const [row] = await db
    .select({ id: users.id, email: users.email, confirmed: users.emailVerified })
    .from(users)
    .innerJoin(businessMembers, and(eq(businessMembers.userId, users.id), eq(businessMembers.role, 'owner'), eq(businessMembers.isActive, true)))
    .innerJoin(businesses, and(eq(businesses.id, businessMembers.businessId), isNull(businesses.deletedAt)))
    .where(eq(users.email, email))
    .limit(1);
  if (!row) return null;
  // Only an ACTIVE admin is refused: a removed admin who also owns a business is just an owner again.
  const [admin] = await db
    .select({ id: platformAdmins.id })
    .from(platformAdmins)
    .where(and(eq(platformAdmins.userId, row.id), eq(platformAdmins.isActive, true)))
    .limit(1);
  return admin ? null : { userId: row.id, email: row.email, confirmed: row.confirmed };
}

/**
 * I13 "Email me a sign-in link". Sends the link only if this email is a business owner's login, and says
 * nothing about whether it is (no way to find out which emails have accounts).
 */
export async function requestWebSignInLink(deps: BillingDeps, email: string, now = Date.now()): Promise<void> {
  const key = email.toLowerCase();
  const last = lastLinkAt.get(key);
  if (last !== undefined && now - last < LINK_COOLDOWN_MS) return;
  lastLinkAt.set(key, now);
  if (lastLinkAt.size > 5000) {
    for (const [k, t] of lastLinkAt) if (now - t > LINK_COOLDOWN_MS) lastLinkAt.delete(k);
  }
  const owner = await findOwnerUser(deps.db, email);
  if (!owner) return;
  // Better Auth deletes the password login and every session of an UNCONFIRMED email that opens a sign-in link
  // (anti-hijack rule). So an owner who has not confirmed yet gets the confirmation email (M1) instead.
  if (!owner.confirmed) {
    await sendConfirmEmail(deps.db, deps.mailer, deps.env, owner.userId);
    return;
  }
  await deps.auth.api.signInMagicLink({
    body: {
      email: owner.email,
      callbackURL: `${website(deps.env)}/billing`,
      errorCallbackURL: `${website(deps.env)}/billing/link-expired`,
    },
    headers: new Headers(),
  });
}

/**
 * The app's "Continue with …": a one-time link that opens the website already signed in (not emailed).
 * The user is the signed-in owner of the app session, so no email can be chosen by the caller.
 */
export async function createWebHandoffLink(
  deps: BillingDeps,
  userId: number,
  plan: PaidPlan | undefined,
  page: WebLinkPage = 'pay',
): Promise<{ url: string }> {
  const [user] = await deps.db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  const owner = user ? await findOwnerUser(deps.db, user.email) : null;
  if (!owner || owner.userId !== userId) throw new AppError(403, BILLING_ERRORS.notOwner, 'Only the business owner can pay for the plan');
  if (!owner.confirmed) {
    // Same reason as above: opening a link with an unconfirmed email would delete this owner's password login.
    await sendConfirmEmail(deps.db, deps.mailer, deps.env, owner.userId);
    throw new AppError(
      409,
      BILLING_ERRORS.emailNotConfirmed,
      'Confirm your email first. We just sent you a confirmation link; open it, then try again.',
    );
  }
  const handoffId = randomBytes(16).toString('hex');
  const callback = new URL(page === 'account' ? '/billing/account' : '/billing', website(deps.env));
  if (page === 'pay' && plan && PAID_PLANS.includes(plan)) callback.searchParams.set('plan', plan);
  await deps.auth.api.signInMagicLink({
    body: {
      email: owner.email,
      callbackURL: callback.toString(),
      errorCallbackURL: `${website(deps.env)}/billing/link-expired`,
      metadata: { handoffId },
    },
    headers: new Headers(),
  });
  const url = takeHandoffLink(handoffId);
  if (!url) throw new AppError(500, 'handoff_failed', 'Could not open the billing page. Please try again.');
  return { url };
}
