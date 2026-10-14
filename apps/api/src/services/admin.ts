import { and, count, desc, eq, gte, isNull, sql, sum, type SQL } from 'drizzle-orm';
import { fromZonedTime } from 'date-fns-tz';
import {
  adminAuditLog,
  bookings,
  businesses,
  businessMembers,
  paymentAccounts,
  payments,
  platformAdmins,
  resources,
  subscriptions,
  users,
  type Db,
  type Tx,
} from '@outletbooking/db';
import {
  adminPlanState,
  hasPlanAccess,
  type AdminAction,
  type AdminBusinessDetail,
  type AdminBusinessesResponse,
  type AdminBusinessQuery,
  type AdminBusinessRow,
  type AdminKpis,
  type AdminMe,
  type AuditEntry,
  type AuditLogQuery,
  type BookingPageInput,
  type BusinessTemplate,
  type ExtendTrialInput,
  type SubscriptionStatus,
} from '@outletbooking/shared';
import { AppError, notFound } from '../errors';

const DAY_MS = 24 * 60 * 60 * 1000;
const TZ = 'Asia/Kuala_Lumpur';
/** Furthest an admin can push a trial from today. */
const MAX_TRIAL_DAYS = 365;

/** Null when the user is not an active platform admin. */
export async function getPlatformAdmin(
  db: Db,
  userId: number,
): Promise<{ admin: AdminMe; twoFactorEnabled: boolean } | null> {
  const [row] = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: platformAdmins.role,
      twoFactorEnabled: users.twoFactorEnabled,
    })
    .from(platformAdmins)
    .innerJoin(users, eq(users.id, platformAdmins.userId))
    .where(and(eq(platformAdmins.userId, userId), eq(platformAdmins.isActive, true)))
    .limit(1);
  if (!row) return null;
  const { twoFactorEnabled, role, ...me } = row;
  return { admin: { ...me, role: role === 'super_admin' ? 'super_admin' : 'support' }, twoFactorEnabled };
}

/** First active owner of the business (one per business today). */
const ownerUserId = sql<number | null>`(select ${businessMembers.userId} from ${businessMembers}
  where ${businessMembers.businessId} = ${businesses.id} and ${businessMembers.role} = 'owner' and ${businessMembers.isActive}
  order by ${businessMembers.id} limit 1)`;

function selectBusinesses(q: Db | Tx, since: Date) {
  return q
    .select({
      id: businesses.id,
      name: businesses.name,
      slug: businesses.slug,
      template: businesses.template,
      phone: businesses.phone,
      whatsappPhone: businesses.whatsappPhone,
      resourceLabel: businesses.resourceLabel,
      bookingEnabled: businesses.bookingEnabled,
      createdAt: businesses.createdAt,
      owner: { name: users.name, email: users.email, phone: users.phone },
      sub: {
        plan: subscriptions.plan,
        status: subscriptions.status,
        trialEndsAt: subscriptions.trialEndsAt,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      },
      bookings30d: sql<number>`(select count(*)::int from ${bookings}
        where ${bookings.businessId} = ${businesses.id} and ${bookings.createdAt} >= ${since.toISOString()})`,
      trialExtended: sql<boolean>`exists(select 1 from ${adminAuditLog}
        where ${adminAuditLog.businessId} = ${businesses.id} and ${adminAuditLog.action} = 'extend_trial')`,
    })
    .from(businesses)
    .leftJoin(subscriptions, eq(subscriptions.businessId, businesses.id))
    .leftJoin(users, eq(users.id, ownerUserId));
}

type Row = Awaited<ReturnType<ReturnType<typeof selectBusinesses>['execute']>>[number];

function toRow(r: Row, now: Date): AdminBusinessRow {
  const sub =
    r.sub && r.sub.status !== null && r.sub.trialEndsAt !== null
      ? {
          plan: r.sub.plan ?? 'trial',
          status: r.sub.status as SubscriptionStatus,
          trialEndsAt: r.sub.trialEndsAt,
          currentPeriodEnd: r.sub.currentPeriodEnd,
        }
      : null;
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    template: r.template as BusinessTemplate,
    ownerName: r.owner?.name ?? null,
    phone: r.phone ?? r.owner?.phone ?? null,
    state: adminPlanState(sub, r.trialExtended, now),
    subscription: sub && {
      plan: sub.plan,
      status: sub.status,
      trialEndsAt: sub.trialEndsAt.toISOString(),
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      hasAccess: hasPlanAccess(sub, now),
    },
    bookingEnabled: r.bookingEnabled,
    bookings30d: Number(r.bookings30d),
    createdAt: r.createdAt.toISOString(),
  };
}

/** I1: every business with KPIs. KPIs count all businesses; the list follows the search and filter. */
export async function listAdminBusinesses(
  db: Db,
  query: AdminBusinessQuery,
  now: Date = new Date(),
): Promise<AdminBusinessesResponse> {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const [rows, [revenue]] = await Promise.all([
    selectBusinesses(db, since).where(isNull(businesses.deletedAt)).orderBy(desc(businesses.createdAt)),
    db
      .select({ sen: sum(payments.amountSen) })
      .from(payments)
      .where(and(eq(payments.purpose, 'subscription'), eq(payments.status, 'paid'), gte(payments.paidAt, since))),
  ]);
  const all = rows.map((r) => toRow(r, now));
  const weekEnd = now.getTime() + 7 * DAY_MS;
  const kpis: AdminKpis = {
    businesses: all.length,
    onTrial: all.filter((b) => b.state === 'trial' || b.state === 'pilot').length,
    trialEndingThisWeek: all.filter(
      (b) => (b.state === 'trial' || b.state === 'pilot') && new Date(b.subscription!.trialEndsAt).getTime() <= weekEnd,
    ).length,
    paying: all.filter((b) => b.state === 'paying').length,
    trialEnded: all.filter((b) => b.state === 'ended').length,
    revenue30dSen: Number(revenue?.sen ?? 0),
  };

  const needle = query.q?.toLowerCase();
  const list = all.filter((b) => {
    if (needle && !b.name.toLowerCase().includes(needle) && !b.slug.toLowerCase().includes(needle)) return false;
    if (query.filter === 'all') return true;
    if (query.filter === 'trial') return b.state === 'trial' || b.state === 'pilot';
    return b.state === query.filter;
  });
  return { kpis, businesses: list };
}

/** I2: one business. Only "ToyyibPay connected" — never keys or customers' payments. */
export async function getAdminBusiness(db: Db | Tx, businessId: number, now: Date = new Date()): Promise<AdminBusinessDetail> {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const [[row], [res], [staff], [account], auditLog] = await Promise.all([
    selectBusinesses(db, since)
      .where(and(eq(businesses.id, businessId), isNull(businesses.deletedAt)))
      .limit(1),
    db
      .select({ n: count() })
      .from(resources)
      .where(and(eq(resources.businessId, businessId), isNull(resources.deletedAt), eq(resources.isActive, true))),
    db
      .select({ n: count() })
      .from(businessMembers)
      .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.role, 'staff'), eq(businessMembers.isActive, true))),
    db.select({ status: paymentAccounts.status }).from(paymentAccounts).where(eq(paymentAccounts.businessId, businessId)),
    listAuditLog(db, { businessId, limit: 50 }),
  ]);
  if (!row) throw notFound('Business');
  return {
    ...toRow(row, now),
    owner: row.owner && row.owner.name !== null && row.owner.email !== null ? { ...row.owner, name: row.owner.name, email: row.owner.email } : null,
    whatsappPhone: row.whatsappPhone,
    resourceLabel: row.resourceLabel,
    resourceCount: res?.n ?? 0,
    staffCount: staff?.n ?? 0,
    toyyibpayConnected: account?.status === 'connected',
    auditLog,
  };
}

/** I2 audit log (one business) or the whole platform's log, newest first. */
export async function listAuditLog(db: Db | Tx, query: AuditLogQuery): Promise<AuditEntry[]> {
  const where: SQL[] = [];
  if (query.businessId) where.push(eq(adminAuditLog.businessId, query.businessId));
  const rows = await db
    .select({
      id: adminAuditLog.id,
      action: adminAuditLog.action,
      reason: adminAuditLog.reason,
      details: adminAuditLog.details,
      adminId: users.id,
      adminName: users.name,
      businessId: businesses.id,
      businessName: businesses.name,
      createdAt: adminAuditLog.createdAt,
    })
    .from(adminAuditLog)
    .innerJoin(users, eq(users.id, adminAuditLog.adminUserId))
    .leftJoin(businesses, eq(businesses.id, adminAuditLog.businessId))
    .where(and(...where))
    .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id))
    .limit(query.limit);
  return rows.map((r) => ({
    id: r.id,
    action: r.action as AdminAction,
    reason: r.reason,
    details: r.details,
    admin: { id: r.adminId, name: r.adminName },
    business: r.businessId !== null && r.businessName !== null ? { id: r.businessId, name: r.businessName } : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Rule 17: the change and its audit row are written in the same transaction. */
async function audit(
  tx: Tx,
  adminUserId: number,
  businessId: number,
  action: AdminAction,
  reason: string,
  details: Record<string, string | number | boolean | null> = {},
) {
  await tx.insert(adminAuditLog).values({ adminUserId, businessId, action, reason, details });
}

async function lockBusiness(tx: Tx, businessId: number) {
  const [biz] = await tx
    .select({ id: businesses.id, bookingEnabled: businesses.bookingEnabled })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), isNull(businesses.deletedAt)))
    .for('update');
  if (!biz) throw notFound('Business');
  return biz;
}

/**
 * I2 "Extend free trial": +N days from the later of now and the current trial end, or until the end of a
 * picked day (Malaysia time). An ended trial or plan restarts as a trial. Paying businesses are refused.
 */
export async function extendTrial(
  db: Db,
  adminUserId: number,
  businessId: number,
  input: ExtendTrialInput,
  now: Date = new Date(),
): Promise<AdminBusinessDetail> {
  await db.transaction(async (tx) => {
    await lockBusiness(tx, businessId);
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.businessId, businessId)).for('update');
    if (!sub) throw notFound('Subscription');
    if (sub.status !== 'trialing' && hasPlanAccess(sub, now)) {
      throw new AppError(409, 'on_paid_plan', 'This business is on a paid plan. Only trials can be extended.');
    }

    const base = new Date(Math.max(now.getTime(), sub.trialEndsAt.getTime()));
    const newEnd =
      input.days !== undefined
        ? new Date(base.getTime() + input.days * DAY_MS)
        : fromZonedTime(`${input.until}T23:59:59.999`, TZ);
    if (Number.isNaN(newEnd.getTime())) throw new AppError(400, 'invalid_date', 'Pick a valid date');
    if (newEnd.getTime() <= base.getTime()) {
      throw new AppError(400, 'trial_date_too_early', 'Pick a date after the current trial end');
    }
    if (newEnd.getTime() > now.getTime() + MAX_TRIAL_DAYS * DAY_MS) {
      throw new AppError(400, 'trial_too_long', `A trial can be extended up to ${MAX_TRIAL_DAYS} days from today`);
    }

    await tx
      .update(subscriptions)
      .set({ plan: 'trial', status: 'trialing', trialEndsAt: newEnd })
      .where(eq(subscriptions.id, sub.id));
    await audit(tx, adminUserId, businessId, 'extend_trial', input.reason, {
      from: sub.trialEndsAt.toISOString(),
      to: newEnd.toISOString(),
      days: input.days ?? null,
      previousStatus: sub.status,
    });
  });
  return getAdminBusiness(db, businessId, now);
}

/** I2 "Booking page live" switch (same flag as the owner's switch; the public page also needs plan access). */
export async function setBookingPage(
  db: Db,
  adminUserId: number,
  businessId: number,
  input: BookingPageInput,
): Promise<AdminBusinessDetail> {
  await db.transaction(async (tx) => {
    const biz = await lockBusiness(tx, businessId);
    if (biz.bookingEnabled === input.enabled) {
      throw new AppError(409, 'no_change', input.enabled ? 'The booking page is already live' : 'The booking page is already paused');
    }
    await tx.update(businesses).set({ bookingEnabled: input.enabled }).where(eq(businesses.id, businessId));
    await audit(tx, adminUserId, businessId, input.enabled ? 'resume_booking_page' : 'pause_booking_page', input.reason);
  });
  return getAdminBusiness(db, businessId);
}

/** A support note on the business (audit log only, no change). */
export async function addAdminNote(db: Db, adminUserId: number, businessId: number, reason: string): Promise<AdminBusinessDetail> {
  await db.transaction(async (tx) => {
    await lockBusiness(tx, businessId);
    await audit(tx, adminUserId, businessId, 'note', reason);
  });
  return getAdminBusiness(db, businessId);
}

