import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  adminAuditLog,
  businesses,
  businessMembers,
  leads,
  platformAdmins,
  subscriptions,
  supportCases,
  supportNotes,
  users,
  type Db,
  type Tx,
} from '@outletbooking/db';
import type {
  AddSupportNoteInput,
  AdminAction,
  CreateSupportCaseInput,
  LeadReason,
  LeadStatus,
  SupportCaseDetail,
  SupportCaseRow,
  SupportCasesQuery,
  SupportLead,
  SupportLeadsQuery,
  SupportNote,
  SupportNoteKind,
  SupportSource,
  SupportStatus,
  SupportSummary,
} from '@outletbooking/shared';
import { createSupportCaseSchema } from '@outletbooking/shared';
import { AppError, notFound } from '../errors';

/**
 * I11 · Support cases and website leads. Cases are notes for FTech staff (replies to owners still go through
 * WhatsApp or email); leads come from the website contact form (I19).
 *
 * Every change writes admin_audit_log (`support_case_update`) in the same transaction (rule 17). The audit
 * row says what changed ("Case #41 · status open → waiting"), never the note text, which can hold what an
 * owner wrote.
 */

type Q = Db | Tx;

async function audit(tx: Tx, adminUserId: number, businessId: number | null, summary: string, caseId: number | null) {
  const action: AdminAction = 'support_case_update';
  await tx.insert(adminAuditLog).values({
    adminUserId,
    businessId,
    action,
    reason: summary,
    details: { summary, caseId },
  });
}

const adminUsers = users;

export async function getSupportSummary(db: Db): Promise<SupportSummary> {
  const [byStatus, byLead] = await Promise.all([
    db
      .select({ status: supportCases.status, n: sql<number>`count(*)::int` })
      .from(supportCases)
      .groupBy(supportCases.status),
    db.select({ status: leads.status, n: sql<number>`count(*)::int` }).from(leads).groupBy(leads.status),
  ]);
  const cases = (s: string) => byStatus.find((r) => r.status === s)?.n ?? 0;
  const lead = (s: string) => byLead.find((r) => r.status === s)?.n ?? 0;
  return {
    open: cases('open'),
    waiting: cases('waiting'),
    closed: cases('closed'),
    leads: lead('new') + lead('contacted'),
    newLeads: lead('new'),
  };
}

function caseSelect(q: Q) {
  return q
    .select({
      id: supportCases.id,
      title: supportCases.title,
      status: supportCases.status,
      source: supportCases.source,
      leadId: supportCases.leadId,
      closedAt: supportCases.closedAt,
      createdAt: supportCases.createdAt,
      updatedAt: supportCases.updatedAt,
      businessId: businesses.id,
      businessName: businesses.name,
      assignedId: adminUsers.id,
      assignedName: adminUsers.name,
      // The newest note moves a case to the top of its list.
      lastNoteAt: sql<Date | null>`(select max(${supportNotes.createdAt}) from ${supportNotes} where ${supportNotes.caseId} = ${supportCases.id})`,
    })
    .from(supportCases)
    .leftJoin(businesses, eq(businesses.id, supportCases.businessId))
    .leftJoin(adminUsers, eq(adminUsers.id, supportCases.assignedAdminUserId));
}

type CaseRecord = Awaited<ReturnType<ReturnType<typeof caseSelect>['execute']>>[number];

function toCaseRow(r: CaseRecord): SupportCaseRow {
  const latest = [r.updatedAt, r.lastNoteAt ? new Date(r.lastNoteAt) : null].filter((d): d is Date => d !== null);
  return {
    id: r.id,
    title: r.title,
    status: r.status as SupportStatus,
    source: r.source as SupportSource,
    business: r.businessId !== null && r.businessName !== null ? { id: r.businessId, name: r.businessName } : null,
    fromLead: r.leadId !== null,
    assignedTo: r.assignedId !== null && r.assignedName !== null ? { id: r.assignedId, name: r.assignedName } : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: new Date(Math.max(...latest.map((d) => d.getTime()))).toISOString(),
  };
}

/** Cases with one status, most recently touched first. */
export async function listSupportCases(db: Db, query: SupportCasesQuery): Promise<SupportCaseRow[]> {
  const where: SQL[] = [eq(supportCases.status, query.status)];
  if (query.q) {
    const needle = query.q.toLowerCase();
    where.push(
      sql`(strpos(lower(${supportCases.title}), ${needle}) > 0 or strpos(lower(coalesce(${businesses.name}, '')), ${needle}) > 0)`,
    );
  }
  const rows = await caseSelect(db).where(and(...where)).orderBy(desc(supportCases.updatedAt), desc(supportCases.id)).limit(100);
  return rows.map(toCaseRow).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function toLead(r: typeof leads.$inferSelect & { caseId: number | null }): SupportLead {
  return {
    id: r.id,
    reason: r.reason as LeadReason,
    name: r.name,
    businessName: r.businessName,
    phone: r.phone,
    email: r.email,
    businessType: r.businessType,
    resourceCount: r.resourceCount,
    message: r.message,
    status: r.status as LeadStatus,
    createdAt: r.createdAt.toISOString(),
    caseId: r.caseId,
  };
}

const leadCaseId = sql<number | null>`(select min(${supportCases.id}) from ${supportCases} where ${supportCases.leadId} = ${leads.id})`;

export async function listSupportLeads(db: Db, query: SupportLeadsQuery): Promise<SupportLead[]> {
  const where: SQL[] = [];
  if (query.status === 'active') where.push(inArray(leads.status, ['new', 'contacted']));
  else where.push(eq(leads.status, query.status));
  if (query.q) {
    const needle = query.q.toLowerCase();
    // "012-333 4444" finds +60123334444: compare digits only (at least 4, so "1" does not match every number).
    const digits = query.q.replace(/\D/g, '');
    const byPhone =
      digits.length >= 4
        ? sql`strpos(regexp_replace(coalesce(${leads.phone}, ''), '[^0-9]', '', 'g'), ${digits}) > 0`
        : sql`false`;
    where.push(
      sql`(strpos(lower(${leads.name}), ${needle}) > 0 or strpos(lower(coalesce(${leads.businessName}, '')), ${needle}) > 0
        or strpos(lower(coalesce(${leads.email}::text, '')), ${needle}) > 0 or ${byPhone})`,
    );
  }
  const rows = await db
    .select({ lead: leads, caseId: leadCaseId })
    .from(leads)
    .where(and(...where))
    .orderBy(desc(leads.createdAt), desc(leads.id))
    .limit(100);
  return rows.map((r) => toLead({ ...r.lead, caseId: r.caseId }));
}

async function loadLead(q: Q, leadId: number): Promise<SupportLead | null> {
  const [row] = await q.select({ lead: leads, caseId: leadCaseId }).from(leads).where(eq(leads.id, leadId)).limit(1);
  return row ? toLead({ ...row.lead, caseId: row.caseId }) : null;
}

export async function getSupportCase(db: Q, caseId: number): Promise<SupportCaseDetail> {
  const [row] = await caseSelect(db).where(eq(supportCases.id, caseId)).limit(1);
  if (!row) throw notFound('Case');

  const [noteRows, info, lead] = await Promise.all([
    db
      .select({
        id: supportNotes.id,
        kind: supportNotes.kind,
        body: supportNotes.body,
        createdAt: supportNotes.createdAt,
        adminId: users.id,
        adminName: users.name,
      })
      .from(supportNotes)
      .leftJoin(users, eq(users.id, supportNotes.adminUserId))
      .where(eq(supportNotes.caseId, caseId))
      .orderBy(asc(supportNotes.createdAt), asc(supportNotes.id)),
    row.businessId === null
      ? Promise.resolve(null)
      : db
          .select({
            id: businesses.id,
            name: businesses.name,
            phone: businesses.phone,
            whatsappPhone: businesses.whatsappPhone,
            ownerName: users.name,
            ownerPhone: users.phone,
            trialEndsAt: subscriptions.trialEndsAt,
          })
          .from(businesses)
          .leftJoin(subscriptions, eq(subscriptions.businessId, businesses.id))
          .leftJoin(
            users,
            sql`${users.id} = (select ${businessMembers.userId} from ${businessMembers}
              where ${businessMembers.businessId} = ${businesses.id} and ${businessMembers.role} = 'owner' and ${businessMembers.isActive}
              order by ${businessMembers.id} limit 1)`,
          )
          .where(and(eq(businesses.id, row.businessId), isNull(businesses.deletedAt)))
          .limit(1)
          .then((r) => r[0] ?? null),
    row.leadId === null ? Promise.resolve(null) : loadLead(db, row.leadId),
  ]);

  const notes: SupportNote[] = noteRows.map((n) => ({
    id: n.id,
    kind: n.kind as SupportNoteKind,
    body: n.body,
    admin: n.adminId !== null && n.adminName !== null ? { id: n.adminId, name: n.adminName } : null,
    createdAt: n.createdAt.toISOString(),
  }));
  return {
    ...toCaseRow(row),
    closedAt: row.closedAt?.toISOString() ?? null,
    businessInfo: info
      ? {
          id: info.id,
          name: info.name,
          ownerName: info.ownerName,
          phone: info.whatsappPhone ?? info.phone ?? info.ownerPhone ?? null,
          trialEndsAt: info.trialEndsAt?.toISOString() ?? null,
        }
      : null,
    lead,
    notes,
  };
}

export async function createSupportCase(db: Db, adminUserId: number, raw: CreateSupportCaseInput): Promise<SupportCaseDetail> {
  const input = createSupportCaseSchema.parse(raw);
  const id = await db.transaction(async (tx) => {
    if (input.businessId !== undefined) {
      const [b] = await tx
        .select({ id: businesses.id })
        .from(businesses)
        .where(and(eq(businesses.id, input.businessId), isNull(businesses.deletedAt)));
      if (!b) throw notFound('Business');
    }
    if (input.leadId !== undefined) {
      const [l] = await tx.select({ id: leads.id }).from(leads).where(eq(leads.id, input.leadId));
      if (!l) throw notFound('Lead');
    }
    const [created] = await tx
      .insert(supportCases)
      .values({
        title: input.title,
        source: input.source,
        businessId: input.businessId ?? null,
        leadId: input.leadId ?? null,
        // The admin who opens a case owns it until someone else takes it.
        assignedAdminUserId: adminUserId,
      })
      .returning({ id: supportCases.id });
    const caseId = created!.id;
    if (input.note) {
      await tx.insert(supportNotes).values({ caseId, adminUserId, kind: input.noteKind, body: input.note });
    }
    await audit(tx, adminUserId, input.businessId ?? null, `Case #${caseId} opened: ${input.title}`, caseId);
    return caseId;
  });
  return getSupportCase(db, id);
}

async function lockCase(tx: Tx, caseId: number) {
  const [row] = await tx
    .select({ id: supportCases.id, status: supportCases.status, businessId: supportCases.businessId, assigned: supportCases.assignedAdminUserId })
    .from(supportCases)
    .where(eq(supportCases.id, caseId))
    .for('update');
  if (!row) throw notFound('Case');
  return row;
}

export async function addSupportNote(db: Db, adminUserId: number, caseId: number, raw: AddSupportNoteInput): Promise<SupportCaseDetail> {
  const input = { body: raw.body.trim(), kind: raw.kind ?? 'internal' };
  await db.transaction(async (tx) => {
    const row = await lockCase(tx, caseId);
    await tx.insert(supportNotes).values({ caseId, adminUserId, kind: input.kind, body: input.body });
    // A note on a closed case is a reason to look at it again; "waiting" stays as it is.
    await tx.update(supportCases).set({ updatedAt: new Date() }).where(eq(supportCases.id, caseId));
    await audit(
      tx,
      adminUserId,
      row.businessId,
      `Case #${caseId} · ${input.kind === 'owner_message' ? 'owner message added' : 'note added'}`,
      caseId,
    );
  });
  return getSupportCase(db, caseId);
}

export async function setSupportStatus(db: Db, adminUserId: number, caseId: number, status: SupportStatus): Promise<SupportCaseDetail> {
  await db.transaction(async (tx) => {
    const row = await lockCase(tx, caseId);
    if (row.status === status) throw new AppError(409, 'no_change', `This case is already ${status}`);
    await tx
      .update(supportCases)
      .set({ status, closedAt: status === 'closed' ? new Date() : null })
      .where(eq(supportCases.id, caseId));
    await audit(tx, adminUserId, row.businessId, `Case #${caseId} · status ${row.status} → ${status}`, caseId);
  });
  return getSupportCase(db, caseId);
}

export async function assignSupportCase(
  db: Db,
  adminUserId: number,
  caseId: number,
  assigneeId: number | null,
): Promise<SupportCaseDetail> {
  await db.transaction(async (tx) => {
    const row = await lockCase(tx, caseId);
    let name = 'nobody';
    if (assigneeId !== null) {
      const [a] = await tx
        .select({ name: users.name })
        .from(platformAdmins)
        .innerJoin(users, eq(users.id, platformAdmins.userId))
        .where(and(eq(platformAdmins.userId, assigneeId), eq(platformAdmins.isActive, true)));
      if (!a) throw new AppError(400, 'unknown_admin', 'That person is not an active admin');
      name = a.name;
    }
    if (row.assigned === assigneeId) throw new AppError(409, 'no_change', 'The case is already assigned that way');
    await tx.update(supportCases).set({ assignedAdminUserId: assigneeId }).where(eq(supportCases.id, caseId));
    await audit(tx, adminUserId, row.businessId, `Case #${caseId} · assigned to ${name}`, caseId);
  });
  return getSupportCase(db, caseId);
}

export async function setLeadStatus(db: Db, adminUserId: number, leadId: number, status: LeadStatus): Promise<SupportLead> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ id: leads.id, status: leads.status, name: leads.name }).from(leads).where(eq(leads.id, leadId)).for('update');
    if (!row) throw notFound('Lead');
    if (row.status === status) throw new AppError(409, 'no_change', `This lead is already ${status}`);
    await tx.update(leads).set({ status }).where(eq(leads.id, leadId));
    await audit(tx, adminUserId, null, `Lead #${leadId} · status ${row.status} → ${status}`, null);
  });
  const lead = await loadLead(db, leadId);
  if (!lead) throw notFound('Lead');
  return lead;
}
