import { and, asc, count, desc, eq, gte, isNull, lt, ne, sql, sum, type SQL } from 'drizzle-orm';
import { addDays, addMonths } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import {
  adminAuditLog,
  adminBusinessNotes,
  bookings,
  businesses,
  businessMembers,
  paymentAccounts,
  payments,
  platformAdmins,
  resources,
  staffInvitations,
  subscriptions,
  users,
  type Db,
  type Tx,
} from '@outletbooking/db';
import {
  adminPlanState,
  AUDIT_EXPORT_MAX_ROWS,
  hasPlanAccess,
  PAID_PLANS,
  type AdminAction,
  type AdminBusinessDetail,
  type AdminBusinessesResponse,
  type AdminBusinessQuery,
  type AdminBusinessRow,
  type AdminKpis,
  type AdminMe,
  type AdminUserOption,
  type AuditEntry,
  type AuditLogFilters,
  type AuditLogQuery,
  type BookingPageInput,
  type BusinessTemplate,
  type ChangeOwnerInput,
  type ChangePlanInput,
  type ExtendTrialInput,
  type FreeMonthsInput,
  type MemberRole,
  type PaidPlan,
  type SubscriptionStatus,
  type SuspendInput,
} from '@outletbooking/shared';
import type { Auth } from '../auth';
import type { Env } from '../env';
import { sendConfirmEmail } from './confirm-email';
import { getGraceDays, planResourceLimit } from './plan-catalog';
import type { Mailer } from './mailer';
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
      suspendedAt: businesses.suspendedAt,
      suspendReason: businesses.suspendReason,
      closeRequestedAt: businesses.closeRequestedAt,
      deletionDueAt: businesses.deletionDueAt,
      createdAt: businesses.createdAt,
      owner: { name: users.name, email: users.email, phone: users.phone },
      sub: {
        plan: subscriptions.plan,
        status: subscriptions.status,
        trialEndsAt: subscriptions.trialEndsAt,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        freeUntil: subscriptions.freeUntil,
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

function toRow(r: Row, now: Date, graceDays: number): AdminBusinessRow {
  const sub =
    r.sub && r.sub.status !== null && r.sub.trialEndsAt !== null
      ? {
          plan: r.sub.plan ?? 'trial',
          status: r.sub.status as SubscriptionStatus,
          trialEndsAt: r.sub.trialEndsAt,
          currentPeriodEnd: r.sub.currentPeriodEnd,
          freeUntil: r.sub.freeUntil,
        }
      : null;
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    template: r.template as BusinessTemplate,
    ownerName: r.owner?.name ?? null,
    phone: r.phone ?? r.owner?.phone ?? null,
    state: adminPlanState(sub, r.trialExtended, now, graceDays),
    subscription: sub && {
      plan: sub.plan,
      status: sub.status,
      trialEndsAt: sub.trialEndsAt.toISOString(),
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      freeUntil: sub.freeUntil?.toISOString() ?? null,
      hasAccess: hasPlanAccess(sub, now, graceDays),
    },
    bookingEnabled: r.bookingEnabled,
    suspended: r.suspendedAt && r.suspendReason !== null ? { at: r.suspendedAt.toISOString(), reason: r.suspendReason } : null,
    closing: r.closeRequestedAt ? { requestedAt: r.closeRequestedAt.toISOString(), deleteOn: r.deletionDueAt?.toISOString() ?? null } : null,
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
  const [graceDays, rows, [revenue]] = await Promise.all([
    getGraceDays(db),
    selectBusinesses(db, since).where(isNull(businesses.deletedAt)).orderBy(desc(businesses.createdAt)),
    db
      .select({ sen: sum(payments.amountSen) })
      .from(payments)
      .where(and(eq(payments.purpose, 'subscription'), eq(payments.status, 'paid'), gte(payments.paidAt, since))),
  ]);
  const all = rows.map((r) => toRow(r, now, graceDays));
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
  const [graceDays, [row], [res], [staff], [account], auditLog, memberRows, inviteRows, noteRows] = await Promise.all([
    getGraceDays(db),
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
    db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        role: businessMembers.role,
        isActive: businessMembers.isActive,
        canViewAll: businessMembers.canViewAll,
        canTakePayments: businessMembers.canTakePayments,
        canEditSetup: businessMembers.canEditSetup,
        joinedAt: businessMembers.createdAt,
      })
      .from(businessMembers)
      .innerJoin(users, eq(users.id, businessMembers.userId))
      .where(eq(businessMembers.businessId, businessId))
      .orderBy(desc(businessMembers.isActive), asc(sql`${businessMembers.role} <> 'owner'`), asc(businessMembers.id)),
    db
      .select({ email: staffInvitations.email, expiresAt: staffInvitations.expiresAt })
      .from(staffInvitations)
      .where(and(eq(staffInvitations.businessId, businessId), isNull(staffInvitations.acceptedAt)))
      .orderBy(desc(staffInvitations.createdAt)),
    db
      .select({ id: adminBusinessNotes.id, body: adminBusinessNotes.body, createdAt: adminBusinessNotes.createdAt, adminId: users.id, adminName: users.name })
      .from(adminBusinessNotes)
      .leftJoin(users, eq(users.id, adminBusinessNotes.adminUserId))
      .where(eq(adminBusinessNotes.businessId, businessId))
      .orderBy(desc(adminBusinessNotes.id))
      .limit(50),
  ]);
  if (!row) throw notFound('Business');
  return {
    ...toRow(row, now, graceDays),
    owner: row.owner && row.owner.name !== null && row.owner.email !== null ? { ...row.owner, name: row.owner.name, email: row.owner.email } : null,
    whatsappPhone: row.whatsappPhone,
    resourceLabel: row.resourceLabel,
    resourceCount: res?.n ?? 0,
    staffCount: staff?.n ?? 0,
    toyyibpayConnected: account?.status === 'connected',
    members: memberRows.map((m) => ({ ...m, role: m.role as MemberRole, joinedAt: m.joinedAt.toISOString() })),
    invitations: inviteRows.map((i) => ({
      email: i.email,
      expiresAt: i.expiresAt.toISOString(),
      expired: i.expiresAt.getTime() <= now.getTime(),
    })),
    notes: noteRows.map((n) => ({
      id: n.id,
      body: n.body,
      admin: n.adminId !== null && n.adminName !== null ? { id: n.adminId, name: n.adminName } : null,
      createdAt: n.createdAt.toISOString(),
    })),
    auditLog,
  };
}

/** Start of a Malaysia calendar day ("2026-10-11") as a UTC instant. */
const startOfMalaysiaDay = (ymd: string) => fromZonedTime(`${ymd}T00:00:00`, TZ);

function auditWhere(filters: AuditLogFilters): SQL[] {
  const where: SQL[] = [];
  if (filters.businessId) where.push(eq(adminAuditLog.businessId, filters.businessId));
  if (filters.adminId) where.push(eq(adminAuditLog.adminUserId, filters.adminId));
  if (filters.action) where.push(eq(adminAuditLog.action, filters.action));
  if (filters.business) {
    // strpos, not LIKE, so "%" and "_" in the search are plain characters.
    const needle = filters.business.toLowerCase();
    where.push(sql`(strpos(lower(${businesses.name}), ${needle}) > 0 or strpos(lower(${businesses.slug}), ${needle}) > 0)`);
  }
  if (filters.from) where.push(gte(adminAuditLog.createdAt, startOfMalaysiaDay(filters.from)));
  if (filters.to) where.push(lt(adminAuditLog.createdAt, addDays(startOfMalaysiaDay(filters.to), 1)));
  return where;
}

/**
 * I2 audit log (one business) and I9 the whole platform's log with filters, newest first.
 * Read only: nothing in the API updates or deletes audit rows.
 */
export async function listAuditLog(db: Db | Tx, query: AuditLogQuery): Promise<AuditEntry[]> {
  const where = auditWhere(query);
  if (query.beforeId) where.push(lt(adminAuditLog.id, query.beforeId));
  return selectAudit(db, where, query.limit);
}

async function selectAudit(db: Db | Tx, where: SQL[], limit: number): Promise<AuditEntry[]> {
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
    .leftJoin(users, eq(users.id, adminAuditLog.adminUserId))
    .leftJoin(businesses, eq(businesses.id, adminAuditLog.businessId))
    .where(and(...where))
    .orderBy(desc(adminAuditLog.id))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    action: r.action as AdminAction,
    reason: r.reason,
    details: r.details,
    admin: r.adminId !== null && r.adminName !== null ? { id: r.adminId, name: r.adminName } : null,
    business: r.businessId !== null && r.businessName !== null ? { id: r.businessId, name: r.businessName } : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** One CSV cell. Text starting with = + - @ is prefixed with ' so spreadsheets never run it as a formula. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * I9 "Export CSV": the filtered log, newest first, at most AUDIT_EXPORT_MAX_ROWS rows.
 * Times are Malaysia time. Details are the raw JSON saved with the entry (before → after).
 */
export async function exportAuditLogCsv(db: Db, filters: AuditLogFilters): Promise<string> {
  const entries = await selectAudit(db, auditWhere(filters), AUDIT_EXPORT_MAX_ROWS);
  const header = ['When (Malaysia time)', 'Admin', 'Action', 'Business', 'Reason', 'Details'];
  const lines = entries.map((e) =>
    [
      formatInTimeZone(new Date(e.createdAt), TZ, 'yyyy-MM-dd HH:mm:ss'),
      e.admin?.name ?? 'System',
      e.action,
      e.business?.name ?? '',
      e.reason,
      Object.keys(e.details).length ? JSON.stringify(e.details) : '',
    ]
      .map(csvCell)
      .join(','),
  );
  // BOM so Excel opens the file as UTF-8 (names with accents, "→").
  return `﻿${[header.join(','), ...lines].join('\r\n')}\r\n`;
}

/** I9 "Admin" filter: everyone who is or was a platform admin, active first, then by name. */
export async function listAdminUsers(db: Db): Promise<AdminUserOption[]> {
  const rows = await db
    .select({ userId: users.id, name: users.name, role: platformAdmins.role, isActive: platformAdmins.isActive })
    .from(platformAdmins)
    .innerJoin(users, eq(users.id, platformAdmins.userId))
    .orderBy(desc(platformAdmins.isActive), asc(users.name));
  return rows.map((r) => ({ ...r, role: r.role === 'super_admin' ? 'super_admin' : 'support' }));
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
    .select({
      id: businesses.id,
      name: businesses.name,
      bookingEnabled: businesses.bookingEnabled,
      suspendedAt: businesses.suspendedAt,
    })
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
    if (sub.status !== 'trialing' && hasPlanAccess(sub, now, await getGraceDays(tx))) {
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

/**
 * I2 "Resend confirm email" to the owner (M1, link valid 24 hours). Refused once the email is confirmed.
 * The audit row is written once the email has been handed to the mailer.
 */
export async function resendOwnerConfirmEmail(
  db: Db,
  mailer: Mailer,
  env: Env,
  adminUserId: number,
  businessId: number,
  reason: string,
): Promise<AdminBusinessDetail> {
  const detail = await getAdminBusiness(db, businessId);
  const owner = detail.members.find((m) => m.role === 'owner' && m.isActive);
  if (!owner) throw new AppError(409, 'no_owner', 'This business has no active owner');
  if (!(await sendConfirmEmail(db, mailer, env, owner.userId))) {
    throw new AppError(409, 'already_confirmed', 'The owner has already confirmed their email');
  }
  await db.transaction(async (tx) => {
    await lockBusiness(tx, businessId);
    await audit(tx, adminUserId, businessId, 'resend_link', reason, { link: 'confirm_email' });
  });
  return getAdminBusiness(db, businessId);
}

/** Compare names the way people type them: case, spacing and accents do not matter. */
function sameName(a: string, b: string) {
  const norm = (x: string) => x.normalize('NFKD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(a) === norm(b);
}

/**
 * I2 "Suspend business" for misuse: every business route refuses the owner and staff (resolveTenant), the app
 * shows the reason, and the booking page shows as paused. Bookings, customers and payments are kept.
 * The admin types the business name to confirm.
 */
export async function suspendBusiness(
  db: Db,
  adminUserId: number,
  businessId: number,
  input: SuspendInput,
  now: Date = new Date(),
): Promise<AdminBusinessDetail> {
  await db.transaction(async (tx) => {
    const biz = await lockBusiness(tx, businessId);
    if (biz.suspendedAt) throw new AppError(409, 'no_change', 'This business is already suspended');
    if (!sameName(input.confirmName, biz.name)) {
      throw new AppError(400, 'name_mismatch', `Type the business name exactly: ${biz.name}`);
    }
    await tx.update(businesses).set({ suspendedAt: now, suspendReason: input.reason }).where(eq(businesses.id, businessId));
    await audit(tx, adminUserId, businessId, 'suspend_business', input.reason);
  });
  return getAdminBusiness(db, businessId, now);
}

/** I2 "Lift suspension": the app works again; the booking page is live again if it was live before. */
export async function unsuspendBusiness(db: Db, adminUserId: number, businessId: number, reason: string): Promise<AdminBusinessDetail> {
  await db.transaction(async (tx) => {
    const biz = await lockBusiness(tx, businessId);
    if (!biz.suspendedAt) throw new AppError(409, 'no_change', 'This business is not suspended');
    await tx.update(businesses).set({ suspendedAt: null, suspendReason: null }).where(eq(businesses.id, businessId));
    await audit(tx, adminUserId, businessId, 'unsuspend_business', reason, { suspendedAt: biz.suspendedAt.toISOString() });
  });
  return getAdminBusiness(db, businessId);
}

/**
 * I2 "Change owner" (with proof from the business): an active staff member becomes the owner; the old owner
 * stays as staff (sees all bookings, can take payments) or is removed. One owner per business.
 */
export async function changeOwner(db: Db, adminUserId: number, businessId: number, input: ChangeOwnerInput): Promise<AdminBusinessDetail> {
  await db.transaction(async (tx) => {
    await lockBusiness(tx, businessId);
    const members = await tx
      .select({ id: businessMembers.id, userId: businessMembers.userId, role: businessMembers.role, email: users.email })
      .from(businessMembers)
      .innerJoin(users, eq(users.id, businessMembers.userId))
      .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.isActive, true)));
    const next = members.find((m) => m.userId === input.newOwnerUserId);
    if (!next) throw new AppError(404, 'not_found', 'Pick an active staff member of this business');
    if (next.role === 'owner') throw new AppError(409, 'no_change', 'This person is already the owner');

    // The app works with one business per login, and an owner membership wins (resolveTenant).
    const [elsewhere] = await tx
      .select({ id: businessMembers.id })
      .from(businessMembers)
      .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
      .where(
        and(
          eq(businessMembers.userId, next.userId),
          eq(businessMembers.role, 'owner'),
          eq(businessMembers.isActive, true),
          isNull(businesses.deletedAt),
          ne(businessMembers.businessId, businessId),
        ),
      )
      .limit(1);
    if (elsewhere) throw new AppError(409, 'owner_elsewhere', 'This person already owns another business');

    const old = members.filter((m) => m.role === 'owner');
    for (const o of old) {
      await tx
        .update(businessMembers)
        .set(
          input.oldOwner === 'staff'
            ? { role: 'staff', canViewAll: true, canTakePayments: true, canEditSetup: false }
            : { role: 'staff', isActive: false },
        )
        .where(eq(businessMembers.id, o.id));
    }
    await tx
      .update(businessMembers)
      .set({ role: 'owner', canViewAll: true, canTakePayments: true, canEditSetup: true })
      .where(eq(businessMembers.id, next.id));
    await audit(tx, adminUserId, businessId, 'change_owner', input.reason, {
      from: old.map((o) => o.email).join(', ') || null,
      to: next.email,
      oldOwner: input.oldOwner,
      proof: input.proof,
    });
  });
  return getAdminBusiness(db, businessId);
}

/**
 * An admin note on the business. The text is saved in `admin_business_notes` (it can hold what an owner said, so it is deleted
 * with the business); the audit log only records that a note was added.
 */
export async function addAdminNote(db: Db, adminUserId: number, businessId: number, body: string): Promise<AdminBusinessDetail> {
  await db.transaction(async (tx) => {
    await lockBusiness(tx, businessId);
    const [note] = await tx.insert(adminBusinessNotes).values({ businessId, adminUserId, body }).returning({ id: adminBusinessNotes.id });
    await audit(tx, adminUserId, businessId, 'note', 'Note added', { noteId: note!.id });
  });
  return getAdminBusiness(db, businessId);
}


const isPaidPlan = (plan: string): plan is PaidPlan => PAID_PLANS.some((p) => p === plan);

/** Paying = on a paid plan that still gives access (active / past_due / cancelled until the period ends). */
function isPaying(sub: { status: string; trialEndsAt: Date; currentPeriodEnd: Date | null; plan: string }, now: Date, graceDays: number) {
  return sub.status !== 'trialing' && isPaidPlan(sub.plan) && hasPlanAccess(sub, now, graceDays);
}

/**
 * I2 "Give free months": no payment is created. A paying business gets its period extended
 * (`current_period_end` += months); a business on a trial or with an ended plan starts the given plan
 * (default Business) today. `free_until` = the new period end, shown to the owner as "Free until …".
 */
export async function giveFreeMonths(
  db: Db,
  adminUserId: number,
  businessId: number,
  input: FreeMonthsInput,
  now: Date = new Date(),
): Promise<AdminBusinessDetail> {
  await db.transaction(async (tx) => {
    await lockBusiness(tx, businessId);
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.businessId, businessId)).for('update');
    if (!sub) throw notFound('Subscription');
    const paying = isPaying(sub, now, await getGraceDays(tx));
    if (paying && sub.currentPeriodEnd === null) {
      throw new AppError(409, 'no_end_date', 'This plan has no end date, so free months would not change anything');
    }
    if (paying && input.plan && input.plan !== sub.plan) {
      throw new AppError(409, 'use_change_plan', 'This business is paying. Change the plan first, then give free months.');
    }
    const plan: PaidPlan = paying && isPaidPlan(sub.plan) ? sub.plan : (input.plan ?? 'business');
    const from = paying ? sub.currentPeriodEnd! : now;
    // Calendar months in Malaysia (31 Jan + 1 month = 28/29 Feb).
    const newEnd = fromZonedTime(addMonths(toZonedTime(from, TZ), input.months), TZ);

    await tx
      .update(subscriptions)
      .set({
        plan,
        status: 'active',
        currentPeriodStart: paying ? sub.currentPeriodStart : now,
        currentPeriodEnd: newEnd,
        freeUntil: newEnd,
        resourceLimit: await planResourceLimit(tx, plan),
      })
      .where(eq(subscriptions.id, sub.id));
    await audit(tx, adminUserId, businessId, 'give_free_months', input.reason, {
      months: input.months,
      plan,
      from: from.toISOString(),
      to: newEnd.toISOString(),
      previousPlan: sub.plan,
      previousStatus: sub.status,
    });
  });
  return getAdminBusiness(db, businessId, now);
}

/** I2 "Change plan" by hand (Starter ↔ Business) for a paying business. Dates stay; the resource limit follows. */
export async function changePlan(
  db: Db,
  adminUserId: number,
  businessId: number,
  input: ChangePlanInput,
  now: Date = new Date(),
): Promise<AdminBusinessDetail> {
  await db.transaction(async (tx) => {
    await lockBusiness(tx, businessId);
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.businessId, businessId)).for('update');
    if (!sub) throw notFound('Subscription');
    if (!isPaying(sub, now, await getGraceDays(tx))) {
      throw new AppError(409, 'not_paying', 'Only a paying business can change plan here. Give free months to start a plan.');
    }
    if (sub.plan === input.plan) throw new AppError(409, 'no_change', `This business is already on ${input.plan}`);
    await tx
      .update(subscriptions)
      .set({ plan: input.plan, resourceLimit: await planResourceLimit(tx, input.plan) })
      .where(eq(subscriptions.id, sub.id));
    await audit(tx, adminUserId, businessId, 'change_plan', input.reason, { from: sub.plan, to: input.plan });
  });
  return getAdminBusiness(db, businessId, now);
}

/**
 * I2 "Send password reset link" to the owner: the same email as E1 (link valid 60 minutes).
 * The audit row is written once Better Auth has accepted the request.
 */
export async function sendOwnerPasswordReset(
  db: Db,
  auth: Auth,
  adminUserId: number,
  businessId: number,
  reason: string,
  headers: Headers,
): Promise<AdminBusinessDetail> {
  const detail = await getAdminBusiness(db, businessId);
  const owner = detail.members.find((m) => m.role === 'owner' && m.isActive);
  if (!owner) throw new AppError(409, 'no_owner', 'This business has no active owner');
  await auth.api.requestPasswordReset({ body: { email: owner.email }, headers });
  await db.transaction(async (tx) => {
    await lockBusiness(tx, businessId);
    await audit(tx, adminUserId, businessId, 'resend_link', reason, { link: 'password_reset' });
  });
  return getAdminBusiness(db, businessId);
}
