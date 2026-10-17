import { and, asc, desc, eq, isNull, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import { adminAuditLog, businesses, privacyRequests, users, type Db, type Tx } from '@outletbooking/db';
import {
  createPrivacyRequestSchema,
  PRIVACY_CHECKLIST,
  PRIVACY_CLOSED_STATUSES,
  PRIVACY_DUE_DAYS,
  PRIVACY_DUE_SOON_DAYS,
  PRIVACY_EXTENSION_DAYS,
  type AdminAction,
  type CreatePrivacyRequestInput,
  type PrivacyChecklistStep,
  type PrivacyKind,
  type PrivacyListQuery,
  type PrivacyRequestDetail,
  type PrivacyRequestRow,
  type PrivacyRequester,
  type PrivacyStatus,
  type PrivacySummary,
} from '@outletbooking/shared';
import { AppError, notFound } from '../errors';

/**
 * I25 · Privacy requests (PDPA). FTech logs each request, ticks off the four steps and answers within 21 days
 * (one extension of 14 days, with a reason). A customer's request is about a business's data: it is passed to the
 * business (`sent_to_business`) and stays open until they confirm.
 *
 * Every change writes admin_audit_log (`privacy_request_update`) in the same transaction (rule 17). The audit row
 * names the request and what changed ("Request #14 · status open → in progress"), never who asked or what they
 * wrote — that stays on the request itself.
 */

type Q = Db | Tx;
const DAY_MS = 86_400_000;
const isClosed = (status: string) => PRIVACY_CLOSED_STATUSES.includes(status as PrivacyStatus);

async function audit(tx: Tx, adminUserId: number, businessId: number | null, summary: string, requestId: number) {
  const action: AdminAction = 'privacy_request_update';
  await tx.insert(adminAuditLog).values({ adminUserId, businessId, action, reason: summary, details: { summary, requestId } });
}

const select = (q: Q) =>
  q
    .select({
      id: privacyRequests.id,
      requesterName: privacyRequests.requesterName,
      requesterEmail: privacyRequests.requesterEmail,
      requesterPhone: privacyRequests.requesterPhone,
      requesterKind: privacyRequests.requesterKind,
      kind: privacyRequests.kind,
      status: privacyRequests.status,
      receivedAt: privacyRequests.receivedAt,
      dueAt: privacyRequests.dueAt,
      extendedReason: privacyRequests.extendedReason,
      checklist: privacyRequests.checklist,
      notes: privacyRequests.notes,
      closedAt: privacyRequests.closedAt,
      businessId: businesses.id,
      businessName: businesses.name,
      handledById: users.id,
      handledByName: users.name,
    })
    .from(privacyRequests)
    .leftJoin(businesses, eq(businesses.id, privacyRequests.businessId))
    .leftJoin(users, eq(users.id, privacyRequests.handledByUserId));

type PrivacyRecord = Awaited<ReturnType<ReturnType<typeof select>['execute']>>[number];

function toRow(r: PrivacyRecord): PrivacyRequestRow {
  return {
    id: r.id,
    receivedAt: r.receivedAt.toISOString(),
    requesterName: r.requesterName,
    requesterKind: r.requesterKind as PrivacyRequester,
    kind: r.kind as PrivacyKind,
    status: r.status as PrivacyStatus,
    business: r.businessId !== null && r.businessName !== null ? { id: r.businessId, name: r.businessName } : null,
    dueAt: r.dueAt.toISOString(),
    closedAt: r.closedAt?.toISOString() ?? null,
  };
}

function toDetail(r: PrivacyRecord): PrivacyRequestDetail {
  const checklist = Object.fromEntries(PRIVACY_CHECKLIST.map((k) => [k, r.checklist[k] === true])) as Record<PrivacyChecklistStep, boolean>;
  return {
    ...toRow(r),
    requesterEmail: r.requesterEmail,
    requesterPhone: r.requesterPhone,
    extendedReason: r.extendedReason,
    checklist,
    notes: r.notes,
    handledBy: r.handledById !== null && r.handledByName !== null ? { id: r.handledById, name: r.handledByName } : null,
  };
}

export async function getPrivacySummary(db: Db, now: Date = new Date()): Promise<PrivacySummary> {
  const soon = new Date(now.getTime() + PRIVACY_DUE_SOON_DAYS * DAY_MS);
  const [row] = await db
    .select({
      open: sql<number>`count(*)::int`,
      overdue: sql<number>`count(*) filter (where ${privacyRequests.dueAt} < ${now.toISOString()})::int`,
      dueSoon: sql<number>`count(*) filter (where ${privacyRequests.dueAt} >= ${now.toISOString()} and ${privacyRequests.dueAt} <= ${soon.toISOString()})::int`,
    })
    .from(privacyRequests)
    .where(isNull(privacyRequests.closedAt));
  return { open: row?.open ?? 0, dueSoon: row?.dueSoon ?? 0, overdue: row?.overdue ?? 0 };
}

/** The list for one tab. Open and due-soon: the nearest deadline first; done and all: newest first. */
export async function listPrivacyRequests(db: Db, query: PrivacyListQuery, now: Date = new Date()): Promise<PrivacyRequestRow[]> {
  const where: SQL[] = [];
  if (query.tab === 'open') where.push(isNull(privacyRequests.closedAt));
  if (query.tab === 'due_soon') {
    where.push(isNull(privacyRequests.closedAt));
    where.push(lt(privacyRequests.dueAt, new Date(now.getTime() + PRIVACY_DUE_SOON_DAYS * DAY_MS + 1)));
  }
  if (query.tab === 'done') where.push(isNotNull(privacyRequests.closedAt));
  if (query.q) {
    const needle = query.q.toLowerCase();
    const digits = needle.replace(/\D/g, '');
    where.push(
      sql`(strpos(lower(${privacyRequests.requesterName}), ${needle}) > 0
        or strpos(lower(coalesce(${privacyRequests.requesterEmail}::text, '')), ${needle}) > 0
        or strpos(lower(coalesce(${businesses.name}, '')), ${needle}) > 0
        ${digits.length >= 4 ? sql`or strpos(regexp_replace(coalesce(${privacyRequests.requesterPhone}, ''), '\\D', '', 'g'), ${digits}) > 0` : sql``})`,
    );
  }
  const open = query.tab === 'open' || query.tab === 'due_soon';
  const rows = await select(db)
    .where(and(...where))
    .orderBy(...(open ? [asc(privacyRequests.dueAt), asc(privacyRequests.id)] : [desc(privacyRequests.receivedAt), desc(privacyRequests.id)]))
    .limit(200);
  return rows.map(toRow);
}

export async function getPrivacyRequest(db: Q, id: number): Promise<PrivacyRequestDetail> {
  const [row] = await select(db).where(eq(privacyRequests.id, id));
  if (!row) throw notFound('Privacy request');
  return toDetail(row);
}

/** Midnight at the start of a Malaysia calendar day. */
const startOfMalaysiaDay = (isoDay: string) => new Date(`${isoDay}T00:00:00+08:00`);

export async function createPrivacyRequest(
  db: Db,
  adminUserId: number,
  raw: CreatePrivacyRequestInput,
  now: Date = new Date(),
): Promise<PrivacyRequestDetail> {
  const input = createPrivacyRequestSchema.parse(raw);
  const receivedAt = input.receivedOn ? startOfMalaysiaDay(input.receivedOn) : now;
  if (receivedAt.getTime() > now.getTime()) throw new AppError(400, 'received_in_future', 'The request cannot be received in the future');
  if (input.requesterKind === 'customer' && input.businessId === undefined) {
    throw new AppError(400, 'business_required', 'Pick the business: a customer’s request is passed to the business');
  }
  const id = await db.transaction(async (tx) => {
    if (input.businessId !== undefined) {
      const [b] = await tx.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, input.businessId));
      if (!b) throw notFound('Business');
    }
    const [created] = await tx
      .insert(privacyRequests)
      .values({
        requesterName: input.requesterName,
        requesterEmail: input.requesterEmail ?? null,
        requesterPhone: input.requesterPhone ?? null,
        requesterKind: input.requesterKind,
        kind: input.kind,
        businessId: input.businessId ?? null,
        receivedAt,
        dueAt: new Date(receivedAt.getTime() + PRIVACY_DUE_DAYS * DAY_MS),
        checklist: { logged: true },
        notes: input.notes ?? null,
        handledByUserId: adminUserId,
      })
      .returning({ id: privacyRequests.id });
    await audit(tx, adminUserId, input.businessId ?? null, `Request #${created!.id} logged · ${input.kind}`, created!.id);
    return created!.id;
  });
  return getPrivacyRequest(db, id);
}

async function lock(tx: Tx, id: number) {
  const [row] = await tx.select().from(privacyRequests).where(eq(privacyRequests.id, id)).for('update');
  if (!row) throw notFound('Privacy request');
  return row;
}

export async function setPrivacyStatus(
  db: Db,
  adminUserId: number,
  id: number,
  input: { status: PrivacyStatus; reason?: string },
  now: Date = new Date(),
): Promise<PrivacyRequestDetail> {
  await db.transaction(async (tx) => {
    const row = await lock(tx, id);
    if (row.status === input.status) throw new AppError(409, 'no_change', 'The request already has this status');
    if (input.status === 'rejected' && !input.reason) {
      throw new AppError(400, 'reason_required', 'Say why the request is rejected (what you told the person)');
    }
    if (input.status === 'sent_to_business' && row.businessId === null) {
      throw new AppError(409, 'no_business', 'Pick the business first: there is no business to send this to');
    }
    if (input.status === 'done' && row.checklist.replied !== true) {
      throw new AppError(409, 'checklist_incomplete', 'Reply to the person first, then tick “Replied to the person”');
    }
    const closed = isClosed(input.status);
    await tx
      .update(privacyRequests)
      .set({
        status: input.status,
        // Closing stamps the time; reopening clears it so the deadline counts again.
        closedAt: closed ? (isClosed(row.status) ? row.closedAt : now) : null,
        handledByUserId: row.handledByUserId ?? adminUserId,
        ...(input.status === 'rejected' && input.reason
          ? { notes: [row.notes, `Rejected: ${input.reason}`].filter(Boolean).join('\n') }
          : {}),
      })
      .where(eq(privacyRequests.id, id));
    await audit(tx, adminUserId, row.businessId, `Request #${id} · status ${row.status} → ${input.status}`, id);
  });
  return getPrivacyRequest(db, id);
}

export async function setPrivacyChecklist(
  db: Db,
  adminUserId: number,
  id: number,
  input: { step: PrivacyChecklistStep; done: boolean },
): Promise<PrivacyRequestDetail> {
  await db.transaction(async (tx) => {
    const row = await lock(tx, id);
    if (input.step === 'logged') throw new AppError(409, 'always_logged', 'The request is always logged');
    if (isClosed(row.status)) throw new AppError(409, 'closed', 'This request is closed. Reopen it to change the steps.');
    if ((row.checklist[input.step] === true) === input.done) return;
    await tx
      .update(privacyRequests)
      .set({ checklist: { ...row.checklist, [input.step]: input.done }, handledByUserId: row.handledByUserId ?? adminUserId })
      .where(eq(privacyRequests.id, id));
    await audit(tx, adminUserId, row.businessId, `Request #${id} · step ${input.step} ${input.done ? 'done' : 'undone'}`, id);
  });
  return getPrivacyRequest(db, id);
}

export async function setPrivacyNotes(db: Db, adminUserId: number, id: number, notes: string): Promise<PrivacyRequestDetail> {
  await db.transaction(async (tx) => {
    const row = await lock(tx, id);
    await tx.update(privacyRequests).set({ notes: notes || null }).where(eq(privacyRequests.id, id));
    // The note text can hold what the person wrote, so the audit row only says that it changed.
    await audit(tx, adminUserId, row.businessId, `Request #${id} · note edited`, id);
  });
  return getPrivacyRequest(db, id);
}

/** "More time (+14 days)": once per request, with a reason, while it is still open. */
export async function extendPrivacyRequest(db: Db, adminUserId: number, id: number, reason: string): Promise<PrivacyRequestDetail> {
  await db.transaction(async (tx) => {
    const row = await lock(tx, id);
    if (isClosed(row.status)) throw new AppError(409, 'closed', 'This request is closed');
    if (row.extendedReason !== null) throw new AppError(409, 'already_extended', 'The deadline was already extended once');
    await tx
      .update(privacyRequests)
      .set({ dueAt: new Date(row.dueAt.getTime() + PRIVACY_EXTENSION_DAYS * DAY_MS), extendedReason: reason })
      .where(eq(privacyRequests.id, id));
    await audit(tx, adminUserId, row.businessId, `Request #${id} · more time +${PRIVACY_EXTENSION_DAYS} days: ${reason}`, id);
  });
  return getPrivacyRequest(db, id);
}
