import { addDays, differenceInMonths, subMonths } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { and, eq, inArray, isNotNull, isNull, notExists, or, sql } from 'drizzle-orm';
import {
  adminAuditLog,
  businesses,
  businessMembers,
  platformSettings,
  subscriptions,
  users,
  type Db,
  type Tx,
} from '@outletbooking/db';
import {
  DELETION_RELEASE_MIN_DAYS,
  hasPlanAccess,
  type AdminAction,
  type BusinessTemplate,
  type DeletionCounts,
  type DeletionQueue,
  type DeletionReason,
  type DeletionRow,
  type DeletionTab,
} from '@outletbooking/shared';
import type { Env } from '../env';
import { AppError, notFound } from '../errors';
import { deletionNoticeEmail } from './billing-emails';
import type { Mailer } from './mailer';
import { businessPrefix, type ObjectStorage } from './storage';

/**
 * I26 · Data deletion. Rules (Terms and Privacy notice, PRD FR-21.5):
 *  - no plan for 12 months → an admin sends the M7 notice → deleted 30 days later;
 *  - owner asked to close (I2) → deleted 90 days later;
 *  - paying again, or a hold (with a reason), stops it. The daily job only deletes what is STILL due, unpaid and not on
 *    hold at that moment, and only when `DATA_DELETION_ENABLED` is on for the server.
 * Deleting removes the business's customers, bookings, staff accounts, files and settings. It keeps FTech's own plan payment
 * and receipt records (7 years, tax), the business row with its name only, and the audit log.
 */

type Q = Db | Tx;
const TZ = 'Asia/Kuala_Lumpur';
const DAY_MS = 86_400_000;

export interface DeletionDeps {
  db: Db;
  env: Env;
  mailer: Mailer;
  storage: ObjectStorage | null;
}

// ------------------------------------------------------------ what "unpaid" means

interface SubFacts {
  status: string;
  trialEndsAt: Date;
  currentPeriodEnd: Date | null;
  freeUntil: Date | null;
}

/** When the business last had a plan or trial running (the later of trial end, paid period end and free months). */
export function lastAccessEnd(sub: SubFacts): Date {
  return new Date(Math.max(sub.trialEndsAt.getTime(), sub.currentPeriodEnd?.getTime() ?? 0, sub.freeUntil?.getTime() ?? 0));
}

/** No plan for at least `months` months: access has ended (grace included) and ended that long ago. Open-ended plans never count. */
export function isUnpaidFor(sub: SubFacts | null, createdAt: Date, months: number, graceDays: number, now: Date): boolean {
  if (!sub) return subMonths(now, months).getTime() >= createdAt.getTime();
  if ((sub.status === 'active' || sub.status === 'past_due') && sub.currentPeriodEnd === null) return false;
  if (hasPlanAccess(sub, now, graceDays)) return false;
  return lastAccessEnd(sub).getTime() <= subMonths(now, months).getTime();
}

async function settings(q: Q) {
  const [row] = await q.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1);
  return {
    graceDays: row?.graceDays ?? 3,
    unpaidMonths: row?.unpaidDeleteAfterMonths ?? 12,
    noticeDays: row?.deletionNoticeDays ?? 30,
    closeDays: row?.closeDeleteAfterDays ?? 90,
  };
}

// ------------------------------------------------------------ the queue

const selectBusinesses = (q: Q) =>
  q
    .select({
      id: businesses.id,
      name: businesses.name,
      template: businesses.template,
      createdAt: businesses.createdAt,
      closeRequestedAt: businesses.closeRequestedAt,
      noticeSentAt: businesses.deletionNoticeSentAt,
      dueAt: businesses.deletionDueAt,
      holdReason: businesses.deletionHoldReason,
      deletedAt: businesses.deletedAt,
      sub: {
        status: subscriptions.status,
        trialEndsAt: subscriptions.trialEndsAt,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        freeUntil: subscriptions.freeUntil,
      },
    })
    .from(businesses)
    .leftJoin(subscriptions, eq(subscriptions.businessId, businesses.id));

type BizRecord = Awaited<ReturnType<ReturnType<typeof selectBusinesses>['execute']>>[number];

const subFacts = (r: BizRecord): SubFacts | null =>
  r.sub && r.sub.status !== null && r.sub.trialEndsAt !== null
    ? { status: r.sub.status, trialEndsAt: r.sub.trialEndsAt, currentPeriodEnd: r.sub.currentPeriodEnd, freeUntil: r.sub.freeUntil }
    : null;

function toRow(r: BizRecord, cfg: Awaited<ReturnType<typeof settings>>, now: Date): DeletionRow | null {
  const base = { id: r.id, name: r.name, template: r.template as BusinessTemplate };
  if (r.deletedAt) {
    return { ...base, reason: r.closeRequestedAt ? 'close_request' : 'unpaid', since: null, unpaidMonths: null, noticeSentAt: r.noticeSentAt?.toISOString() ?? null, deleteOn: r.dueAt?.toISOString() ?? null, holdReason: null, deletedAt: r.deletedAt.toISOString(), tab: 'done' };
  }
  const sub = subFacts(r);
  const unpaid = isUnpaidFor(sub, r.createdAt, cfg.unpaidMonths, cfg.graceDays, now);
  const reason: DeletionReason | null = r.closeRequestedAt ? 'close_request' : unpaid || r.noticeSentAt ? 'unpaid' : null;
  if (reason === null && !r.holdReason) return null;
  const since = r.closeRequestedAt ?? (sub ? lastAccessEnd(sub) : r.createdAt);
  const tab: DeletionTab = r.holdReason ? 'on_hold' : r.closeRequestedAt || r.noticeSentAt ? 'notice_sent' : 'todo';
  return {
    ...base,
    reason: reason ?? 'unpaid',
    since: since.toISOString(),
    unpaidMonths: reason === 'unpaid' || reason === null ? Math.max(0, differenceInMonths(now, since)) : null,
    noticeSentAt: r.noticeSentAt?.toISOString() ?? null,
    deleteOn: r.dueAt?.toISOString() ?? null,
    holdReason: r.holdReason,
    deletedAt: null,
    tab,
  };
}

export async function getDeletionQueue(db: Db, tab: DeletionTab, autoDeleteEnabled: boolean, now: Date = new Date()): Promise<DeletionQueue> {
  const cfg = await settings(db);
  const cutoff = subMonths(now, cfg.unpaidMonths);
  const records = await selectBusinesses(db).where(
    or(
      isNotNull(businesses.deletedAt),
      isNotNull(businesses.closeRequestedAt),
      isNotNull(businesses.deletionNoticeSentAt),
      isNotNull(businesses.deletionDueAt),
      isNotNull(businesses.deletionHoldReason),
      // Cheap first cut for "no plan for 12 months"; the exact rule runs in `isUnpaidFor`.
      sql`greatest(${subscriptions.trialEndsAt}, coalesce(${subscriptions.currentPeriodEnd}, ${subscriptions.trialEndsAt}), coalesce(${subscriptions.freeUntil}, ${subscriptions.trialEndsAt})) <= ${cutoff.toISOString()}`,
      isNull(subscriptions.id),
    ),
  );
  const rows = records.map((r) => toRow(r, cfg, now)).filter((r): r is DeletionRow => r !== null);
  const soonEnd = now.getTime() + 30 * DAY_MS;
  const year = formatInTimeZone(now, TZ, 'yyyy');
  const summary = {
    noticeToSend: rows.filter((r) => r.tab === 'todo').length,
    deletingSoon: rows.filter((r) => r.tab === 'notice_sent' && r.deleteOn !== null && Date.parse(r.deleteOn) <= soonEnd).length,
    onHold: rows.filter((r) => r.tab === 'on_hold').length,
    deletedThisYear: rows.filter((r) => r.deletedAt !== null && formatInTimeZone(new Date(r.deletedAt), TZ, 'yyyy') === year).length,
    autoDeleteEnabled,
  };
  const shown = rows
    .filter((r) => r.tab === tab)
    .sort((a, b) => (tab === 'done' ? Date.parse(b.deletedAt ?? '0') - Date.parse(a.deletedAt ?? '0') : Date.parse(a.deleteOn ?? a.since ?? '0') - Date.parse(b.deleteOn ?? b.since ?? '0')))
    .slice(0, 200);
  return { summary, rows: shown };
}

// ------------------------------------------------------------ admin actions

async function audit(q: Q, adminUserId: number | null, businessId: number, action: AdminAction, reason: string, details: Record<string, string | number | boolean | null> = {}) {
  await q.insert(adminAuditLog).values({ adminUserId, businessId, action, reason, details });
}

async function lockBusiness(tx: Tx, businessId: number) {
  const [row] = await tx.select().from(businesses).where(eq(businesses.id, businessId)).for('update');
  if (!row) throw notFound('Business');
  if (row.deletedAt) throw new AppError(409, 'already_deleted', 'This business’s data was already deleted');
  return row;
}

async function ownersOf(q: Q, businessId: number) {
  return q
    .select({ userId: users.id, email: users.email })
    .from(businessMembers)
    .innerJoin(users, eq(users.id, businessMembers.userId))
    .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.role, 'owner'), eq(businessMembers.isActive, true)));
}

/**
 * "Send notice": only for a business that really has had no plan for 12 months and has no notice yet. The email goes
 * out BEFORE the clock starts, so a business is never counted down without having been told: if no owner could be
 * emailed, nothing changes.
 */
export async function sendDeletionNotice(deps: DeletionDeps, adminUserId: number, businessId: number, now: Date = new Date()): Promise<void> {
  const cfg = await settings(deps.db);
  const [r] = await selectBusinesses(deps.db).where(eq(businesses.id, businessId));
  if (!r) throw notFound('Business');
  if (r.deletedAt) throw new AppError(409, 'already_deleted', 'This business’s data was already deleted');
  if (r.holdReason) throw new AppError(409, 'on_hold', 'This business is on hold. Release the hold first.');
  if (r.closeRequestedAt) throw new AppError(409, 'close_request', 'The owner asked to close: the deletion date is already set');
  if (r.noticeSentAt) throw new AppError(409, 'already_sent', 'The notice was already sent');
  if (!isUnpaidFor(subFacts(r), r.createdAt, cfg.unpaidMonths, cfg.graceDays, now)) {
    throw new AppError(409, 'not_eligible', 'This business has had a plan or trial within the last 12 months');
  }
  const owners = await ownersOf(deps.db, businessId);
  const dueAt = addDays(now, cfg.noticeDays);
  const base = deps.env.WEBSITE_URL.replace(/\/+$/, '');
  const email = deletionNoticeEmail({
    businessName: r.name,
    deleteOn: formatInTimeZone(dueAt, TZ, 'EEE, d MMM yyyy'),
    keepUrl: `${base}/billing/sign-in`,
    websiteUrl: base,
  });
  let reached = 0;
  for (const o of owners) {
    try {
      await deps.mailer.send({ to: o.email, ...email, meta: { template: 'deletion_notice', businessId, userId: o.userId } });
      reached++;
    } catch (err) {
      console.error('[deletion] notice email failed for business', businessId, err instanceof Error ? err.message : err);
    }
  }
  if (reached === 0) {
    throw new AppError(409, 'no_email_sent', 'The notice could not be emailed to any owner, so the 30 days have not started');
  }
  await deps.db.transaction(async (tx) => {
    const row = await lockBusiness(tx, businessId);
    if (row.deletionNoticeSentAt) return; // someone else sent it in the meantime
    await tx.update(businesses).set({ deletionNoticeSentAt: now, deletionDueAt: dueAt }).where(eq(businesses.id, businessId));
    await audit(tx, adminUserId, businessId, 'send_deletion_notice', `M7 notice sent to ${reached} owner${reached === 1 ? '' : 's'}`, {
      deleteOn: formatInTimeZone(dueAt, TZ, 'yyyy-MM-dd'),
    });
  });
}

export async function holdDeletion(db: Db, adminUserId: number, businessId: number, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await lockBusiness(tx, businessId);
    if (row.deletionHoldReason) throw new AppError(409, 'already_on_hold', 'This business is already on hold');
    await tx.update(businesses).set({ deletionHoldReason: reason }).where(eq(businesses.id, businessId));
    await audit(tx, adminUserId, businessId, 'hold_deletion', reason);
  });
}

/**
 * Lift a hold. If the delete date has passed meanwhile, it moves to at least 7 days from now, so releasing a hold never
 * makes the next job run delete the business without a last warning window.
 */
export async function releaseDeletion(db: Db, adminUserId: number, businessId: number, reason: string, now: Date = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await lockBusiness(tx, businessId);
    if (!row.deletionHoldReason) throw new AppError(409, 'not_on_hold', 'This business is not on hold');
    const earliest = addDays(now, DELETION_RELEASE_MIN_DAYS);
    const dueAt = row.deletionDueAt && row.deletionDueAt.getTime() < earliest.getTime() ? earliest : row.deletionDueAt;
    await tx.update(businesses).set({ deletionHoldReason: null, deletionDueAt: dueAt }).where(eq(businesses.id, businessId));
    await audit(tx, adminUserId, businessId, 'release_deletion', reason, {
      deleteOn: dueAt ? formatInTimeZone(dueAt, TZ, 'yyyy-MM-dd') : null,
    });
  });
}

/** I2 "Close account" (on the owner's written request): the booking page closes at once; the data is deleted 90 days later. */
export async function closeBusiness(db: Db, adminUserId: number, businessId: number, reason: string, now: Date = new Date()): Promise<void> {
  const cfg = await settings(db);
  await db.transaction(async (tx) => {
    const row = await lockBusiness(tx, businessId);
    if (row.closeRequestedAt) throw new AppError(409, 'already_closed', 'This account is already closed');
    const dueAt = addDays(now, cfg.closeDays);
    await tx
      .update(businesses)
      .set({ closeRequestedAt: now, deletionDueAt: dueAt, deletionNoticeSentAt: null })
      .where(eq(businesses.id, businessId));
    await audit(tx, adminUserId, businessId, 'close_account', reason, { deleteOn: formatInTimeZone(dueAt, TZ, 'yyyy-MM-dd') });
  });
}

/** The owner changed their mind before the data was deleted: the booking page opens again and the countdown stops. */
export async function reopenBusiness(db: Db, adminUserId: number, businessId: number, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await lockBusiness(tx, businessId);
    if (!row.closeRequestedAt) throw new AppError(409, 'not_closed', 'This account is not closed');
    await tx.update(businesses).set({ closeRequestedAt: null, deletionDueAt: null, deletionNoticeSentAt: null }).where(eq(businesses.id, businessId));
    await audit(tx, adminUserId, businessId, 'close_account', reason, { undo: true });
  });
}

// ------------------------------------------------------------ the deletion itself

/**
 * Tables that hold a business's data, in the order they are emptied (children first). Every table with a `business_id`
 * column must be in exactly one of these two lists: a test fails when a new table is added and forgotten here.
 */
export const TENANT_TABLES_DELETED = [
  'inspection_item_results',
  'inspection_results',
  'booking_attachments',
  'booking_events',
  // booking payments and refunds are handled by hand below (FTech's plan payments stay)
  'bookings',
  'checklist_items',
  'checklist_sections',
  'listings',
  'resource_services',
  'service_price_rules',
  'time_off',
  'working_hours',
  'services',
  'resources',
  'customers',
  'branches',
  'booking_fields',
  'notifications',
  'staff_invitations',
  'payment_accounts',
  'billing_details',
  'admin_business_notes',
  'business_members',
] as const;

/** Kept on purpose: FTech's plan payments / receipts / plan refunds / subscription, the audit trail, and FTech's own records about the business. */
export const TENANT_TABLES_KEPT = ['admin_audit_log', 'subscriptions', 'payments', 'refunds', 'email_events', 'privacy_requests', 'support_cases'] as const;

const countOf = (res: unknown) => (res as { count?: number }).count ?? 0;

/**
 * Empties one business, in one transaction, and returns how many rows went from each table. Keeps FTech's plan payment
 * records and the business row (name only, marked deleted). Logins left without any business are removed (like H6).
 * Files are removed afterwards: the rows are gone already, so a storage hiccup is only logged.
 */
export async function deleteBusinessData(deps: Pick<DeletionDeps, 'db' | 'storage'>, businessId: number, now: Date = new Date()): Promise<DeletionCounts> {
  const counts: DeletionCounts = {};
  await deps.db.transaction(async (tx) => {
    await lockBusiness(tx, businessId);
    const memberIds = (await tx.select({ userId: businessMembers.userId }).from(businessMembers).where(eq(businessMembers.businessId, businessId))).map((m) => m.userId);

    for (const table of TENANT_TABLES_DELETED) {
      if (table === 'bookings') {
        // Money first: refunds of bookings, then the business's own customer payments (FTech's plan payments stay).
        counts.refunds = countOf(await tx.execute(sql`delete from refunds where business_id = ${businessId} and booking_id is not null`));
        counts.payments = countOf(await tx.execute(sql`delete from payments where business_id = ${businessId} and purpose <> 'subscription'`));
      }
      counts[table] = countOf(await tx.execute(sql`delete from ${sql.identifier(table)} where business_id = ${businessId}`));
    }

    // Logins that no longer belong to any business.
    if (memberIds.length) {
      const removed = await tx
        .delete(users)
        .where(
          and(
            inArray(users.id, [...new Set(memberIds)]),
            notExists(tx.select({ id: businessMembers.id }).from(businessMembers).where(eq(businessMembers.userId, users.id))),
          ),
        )
        .returning({ id: users.id });
      counts.users = removed.length;
    }

    // The row stays for FTech's receipts: name only. The link (slug) stays too, so the old booking page keeps saying "closed".
    await tx
      .update(businesses)
      .set({
        phone: null,
        whatsappPhone: null,
        email: null,
        address: null,
        description: null,
        logoKey: null,
        settings: {},
        bookingEnabled: false,
        deletedAt: now,
        deletionHoldReason: null,
      })
      .where(eq(businesses.id, businessId));
  });
  await deps.storage?.removePrefix(businessPrefix(businessId)).catch((err: unknown) => {
    console.error(`[deletion] could not remove files of business ${businessId}`, err);
  });
  return counts;
}

/** What the daily job did. `skipped`: automatic deletion is off on this server. */
export interface DeletionRun {
  skipped: boolean;
  deleted: number[];
  /** Due, but paid again or no longer qualifying: the notice and date were cleared instead. */
  cleared: number[];
}

/** Never more than this many businesses in one run: a surprise should be small. */
export const DELETION_MAX_PER_RUN = 10;

/**
 * Daily job (3 AM Malaysia time). A business is deleted only when ALL of this is still true at this moment: not on hold,
 * delete date reached, and either the owner asked to close, or it has had no plan for 12 months AND was sent the notice.
 * One that paid again or no longer qualifies has its notice and date cleared (the owner is not deleted).
 */
export async function runDataDeletion(deps: DeletionDeps, now: Date = new Date()): Promise<DeletionRun> {
  if (!deps.env.DATA_DELETION_ENABLED) return { skipped: true, deleted: [], cleared: [] };
  const cfg = await settings(deps.db);
  const due = await selectBusinesses(deps.db)
    .where(and(isNull(businesses.deletedAt), isNull(businesses.deletionHoldReason), isNotNull(businesses.deletionDueAt), sql`${businesses.deletionDueAt} <= ${now.toISOString()}`))
    .orderBy(businesses.deletionDueAt)
    .limit(DELETION_MAX_PER_RUN);
  const run: DeletionRun = { skipped: false, deleted: [], cleared: [] };
  for (const r of due) {
    const closed = r.closeRequestedAt !== null;
    const stillUnpaid = r.noticeSentAt !== null && isUnpaidFor(subFacts(r), r.createdAt, cfg.unpaidMonths, cfg.graceDays, now);
    if (!closed && !stillUnpaid) {
      await deps.db.update(businesses).set({ deletionNoticeSentAt: null, deletionDueAt: null }).where(eq(businesses.id, r.id));
      await audit(deps.db, null, r.id, 'release_deletion', 'Paid again (or no longer unpaid): deletion cancelled automatically');
      run.cleared.push(r.id);
      continue;
    }
    try {
      const counts = await deleteBusinessData(deps, r.id, now);
      await audit(deps.db, null, r.id, 'delete_business_data', closed ? 'Owner asked to close: data deleted' : 'No plan for 12 months: data deleted', {
        customers: counts.customers ?? 0,
        bookings: counts.bookings ?? 0,
        users: counts.users ?? 0,
      });
      run.deleted.push(r.id);
    } catch (err) {
      console.error('[deletion] failed for business', r.id, err instanceof Error ? err.message : err);
    }
  }
  return run;
}

