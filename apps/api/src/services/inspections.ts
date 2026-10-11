import { and, asc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import {
  bookingAttachments,
  bookingFields,
  bookings,
  businesses,
  checklistItems,
  checklistSections,
  inspectionItemResults,
  inspectionResults,
  insertChecklist,
  resources,
  services,
  users,
  type Db,
  type Tx,
} from '@outletbooking/db';
import {
  CHECK_OUTCOMES,
  reportSettings,
  STANDARD_CHECKLIST,
  type CheckOutcome,
  type Checklist,
  type ChecklistSave,
  type Inspection,
  type InspectionReportLink,
  type InspectionSave,
  type OverallResult,
  type PublicInspectionReport,
} from '@outletbooking/shared';
import { AppError, notFound } from '../errors';
import { getBooking, type BookingScope } from './bookings';
import { bookingRef } from './payments';
import { NOTES_STATUSES, requireStorage } from './staff-app';
import type { ObjectStorage } from './storage';

type Q = Db | Tx;

const PHOTO_LINK_TTL_SEC = 60 * 60;

// ───────────────────────────────────────────── ST-VI-C checklist

/** Sections in order with their active checks; sections left without checks are hidden. */
export async function getChecklist(q: Q, businessId: number): Promise<Checklist> {
  const [sections, items] = await Promise.all([
    q
      .select({ id: checklistSections.id, name: checklistSections.name })
      .from(checklistSections)
      .where(eq(checklistSections.businessId, businessId))
      .orderBy(asc(checklistSections.sortOrder), asc(checklistSections.id)),
    q
      .select({ id: checklistItems.id, sectionId: checklistItems.sectionId, label: checklistItems.label })
      .from(checklistItems)
      .where(and(eq(checklistItems.businessId, businessId), eq(checklistItems.isActive, true)))
      .orderBy(asc(checklistItems.sortOrder), asc(checklistItems.id)),
  ]);
  const result = sections
    .map((s) => ({ id: s.id, name: s.name, items: items.filter((i) => i.sectionId === s.id).map(({ id, label }) => ({ id, label })) }))
    .filter((s) => s.items.length);
  return { sections: result, checks: items.length };
}

/**
 * Saves the whole checklist in one transaction. Removed checks are switched off (old reports keep
 * them); a removed section is deleted when none of its checks were ever used, otherwise emptied.
 */
export async function saveChecklist(db: Db, businessId: number, input: ChecklistSave): Promise<Checklist> {
  await db.transaction(async (tx) => {
    const [existingSections, existingItems] = await Promise.all([
      tx.select({ id: checklistSections.id }).from(checklistSections).where(eq(checklistSections.businessId, businessId)),
      tx
        .select({ id: checklistItems.id, sectionId: checklistItems.sectionId })
        .from(checklistItems)
        .where(eq(checklistItems.businessId, businessId)),
    ]);
    const sectionIds = new Set(existingSections.map((s) => s.id));
    const itemSection = new Map(existingItems.map((i) => [i.id, i.sectionId]));

    const keptItems: number[] = [];
    const keptSections: number[] = [];
    for (const [i, section] of input.sections.entries()) {
      let sectionId = section.id;
      if (sectionId !== undefined) {
        if (!sectionIds.has(sectionId)) throw notFound('Checklist section');
        await tx
          .update(checklistSections)
          .set({ name: section.name, sortOrder: i })
          .where(and(eq(checklistSections.businessId, businessId), eq(checklistSections.id, sectionId)));
      } else {
        const [row] = await tx
          .insert(checklistSections)
          .values({ businessId, name: section.name, sortOrder: i })
          .returning({ id: checklistSections.id });
        sectionId = row!.id;
      }
      keptSections.push(sectionId);

      for (const [j, item] of section.items.entries()) {
        if (item.id !== undefined) {
          if (!itemSection.has(item.id)) throw notFound('Check');
          await tx
            .update(checklistItems)
            .set({ label: item.label, sortOrder: j, sectionId, isActive: true })
            .where(and(eq(checklistItems.businessId, businessId), eq(checklistItems.id, item.id)));
          keptItems.push(item.id);
        } else {
          const [row] = await tx
            .insert(checklistItems)
            .values({ businessId, sectionId, label: item.label, sortOrder: j })
            .returning({ id: checklistItems.id });
          keptItems.push(row!.id);
        }
      }
    }

    await tx
      .update(checklistItems)
      .set({ isActive: false })
      .where(and(eq(checklistItems.businessId, businessId), keptItems.length ? notInArray(checklistItems.id, keptItems) : undefined));

    // Removed sections: delete the ones whose checks were never used in a result.
    const removed = [...sectionIds].filter((id) => !keptSections.includes(id));
    if (removed.length) {
      await tx.delete(checklistSections).where(
        and(
          eq(checklistSections.businessId, businessId),
          inArray(checklistSections.id, removed),
          sql`not exists (select 1 from ${inspectionItemResults} r join ${checklistItems} i
            on i.business_id = r.business_id and i.id = r.item_id where i.section_id = ${checklistSections.id})`,
        ),
      );
    }
  });
  return getChecklist(db, businessId);
}

/** "Use the standard checklist" — only when there is no checklist yet. */
export async function useStandardChecklist(db: Db, businessId: number): Promise<Checklist> {
  await db.transaction(async (tx) => {
    const current = await getChecklist(tx, businessId);
    if (current.checks > 0) throw new AppError(409, 'checklist_exists', 'You already have a checklist');
    const [{ next } = { next: 0 }] = await tx
      .select({ next: sql<number>`coalesce(max(${checklistSections.sortOrder}) + 1, 0)::int` })
      .from(checklistSections)
      .where(eq(checklistSections.businessId, businessId));
    await insertChecklist(tx, businessId, STANDARD_CHECKLIST, next);
  });
  return getChecklist(db, businessId);
}

// ───────────────────────────────────────────── S2 inspection result

async function resultRow(q: Q, businessId: number, bookingId: number) {
  const [row] = await q
    .select({ id: inspectionResults.id, overall: inspectionResults.overall, reportSentAt: inspectionResults.reportSentAt })
    .from(inspectionResults)
    .where(and(eq(inspectionResults.businessId, businessId), eq(inspectionResults.bookingId, bookingId)));
  return row ?? null;
}

async function businessSettings(q: Q, businessId: number) {
  const [biz] = await q.select({ settings: businesses.settings }).from(businesses).where(eq(businesses.id, businessId));
  return reportSettings((biz?.settings ?? {}) as Record<string, unknown>);
}

/** Active checks plus any removed check that already has an outcome on this booking. */
async function checksWithOutcomes(q: Q, businessId: number, resultId: number | null) {
  return q
    .select({
      id: checklistItems.id,
      label: checklistItems.label,
      sectionId: checklistSections.id,
      sectionName: checklistSections.name,
      outcome: inspectionItemResults.outcome,
      note: inspectionItemResults.note,
    })
    .from(checklistItems)
    .innerJoin(
      checklistSections,
      and(eq(checklistSections.businessId, checklistItems.businessId), eq(checklistSections.id, checklistItems.sectionId)),
    )
    .leftJoin(
      inspectionItemResults,
      and(
        eq(inspectionItemResults.businessId, checklistItems.businessId),
        eq(inspectionItemResults.itemId, checklistItems.id),
        eq(inspectionItemResults.resultId, resultId ?? 0),
      ),
    )
    .where(
      and(
        eq(checklistItems.businessId, businessId),
        or(eq(checklistItems.isActive, true), sql`${inspectionItemResults.id} is not null`),
      ),
    )
    .orderBy(asc(checklistSections.sortOrder), asc(checklistSections.id), asc(checklistItems.sortOrder), asc(checklistItems.id));
}

function groupSections<T extends { sectionId: number; sectionName: string }, I>(rows: T[], item: (r: T) => I) {
  const out: { id: number; name: string; items: I[] }[] = [];
  for (const r of rows) {
    let section = out.find((s) => s.id === r.sectionId);
    if (!section) out.push((section = { id: r.sectionId, name: r.sectionName, items: [] }));
    section.items.push(item(r));
  }
  return out;
}

export async function getInspection(q: Q, businessId: number, bookingId: number, scope: BookingScope): Promise<Inspection> {
  await getBooking(q, businessId, bookingId, scope);
  const [result, settings] = await Promise.all([resultRow(q, businessId, bookingId), businessSettings(q, businessId)]);
  const rows = await checksWithOutcomes(q, businessId, result?.id ?? null);
  return {
    overall: (result?.overall as OverallResult | null) ?? null,
    sections: groupSections(rows, (r) => ({
      id: r.id,
      label: r.label,
      outcome: (r.outcome as CheckOutcome | null) ?? null,
      note: r.note,
    })),
    reportSentAt: result?.reportSentAt?.toISOString() ?? null,
    reportWhatsapp: settings.reportWhatsapp,
  };
}

/** S2: owner, or staff on their own bookings, once the booking is confirmed. */
export async function saveInspection(
  db: Db,
  businessId: number,
  bookingId: number,
  input: InspectionSave,
  scope: BookingScope,
): Promise<Inspection> {
  const booking = await getBooking(db, businessId, bookingId, scope);
  if (!NOTES_STATUSES.includes(booking.status)) {
    throw new AppError(409, 'not_editable', 'The inspection result can be added once the booking is confirmed');
  }
  await db.transaction(async (tx) => {
    const itemIds = [...new Set(input.items.map((i) => i.itemId))];
    if (itemIds.length) {
      const found = await tx
        .select({ id: checklistItems.id })
        .from(checklistItems)
        .where(and(eq(checklistItems.businessId, businessId), inArray(checklistItems.id, itemIds)));
      if (found.length !== itemIds.length) throw notFound('Check');
    }

    const [result] = await tx
      .insert(inspectionResults)
      .values({ businessId, bookingId, overall: input.overall ?? null })
      .onConflictDoUpdate({
        target: [inspectionResults.businessId, inspectionResults.bookingId],
        // `overall` omitted = keep the current one.
        set: input.overall !== undefined ? { overall: input.overall } : { updatedAt: sql`now()` },
      })
      .returning({ id: inspectionResults.id });

    for (const item of input.items) {
      await tx
        .insert(inspectionItemResults)
        .values({ businessId, resultId: result!.id, itemId: item.itemId, outcome: item.outcome, note: item.note })
        .onConflictDoUpdate({
          target: [inspectionItemResults.resultId, inspectionItemResults.itemId],
          set: { outcome: item.outcome, note: item.note },
        });
    }
  });
  return getInspection(db, businessId, bookingId, scope);
}

/** "Send report on WhatsApp": needs an overall result; marks the report as sent and returns its public link. */
export async function createReportLink(
  db: Db,
  businessId: number,
  bookingId: number,
  scope: BookingScope,
  appPublicUrl: string,
  now = new Date(),
): Promise<InspectionReportLink> {
  await getBooking(db, businessId, bookingId, scope);
  const result = await resultRow(db, businessId, bookingId);
  if (!result?.overall) {
    throw new AppError(409, 'inspection_incomplete', 'Choose the overall result before sending the report');
  }
  await db.update(inspectionResults).set({ reportSentAt: now }).where(eq(inspectionResults.id, result.id));
  const [row] = await db
    .select({ token: bookings.publicToken })
    .from(bookings)
    .where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId)));
  return { reportUrl: `${appPublicUrl.replace(/\/+$/, '')}/report/${row!.token}`, reportSentAt: now.toISOString() };
}

// ───────────────────────────────────────────── public report

/** The customer's report, by the booking's random token. 404 until an overall result is set. */
export async function getPublicReport(
  db: Db,
  storage: ObjectStorage | null,
  token: string,
): Promise<PublicInspectionReport> {
  const [b] = await db
    .select({
      id: bookings.id,
      businessId: bookings.businessId,
      token: bookings.publicToken,
      startAt: bookings.startAt,
      completedAt: bookings.completedAt,
      customFields: bookings.customFields,
      resultNotes: bookings.resultNotes,
      serviceName: services.name,
      inspectorName: users.name,
      resourceName: resources.name,
      business: {
        name: businesses.name,
        phone: businesses.phone,
        whatsappPhone: businesses.whatsappPhone,
        timezone: businesses.timezone,
        settings: businesses.settings,
      },
      resultId: inspectionResults.id,
      overall: inspectionResults.overall,
    })
    .from(bookings)
    .innerJoin(businesses, eq(businesses.id, bookings.businessId))
    .innerJoin(services, and(eq(services.businessId, bookings.businessId), eq(services.id, bookings.serviceId)))
    .innerJoin(resources, and(eq(resources.businessId, bookings.businessId), eq(resources.id, bookings.resourceId)))
    .leftJoin(users, eq(users.id, resources.userId))
    .innerJoin(
      inspectionResults,
      and(eq(inspectionResults.businessId, bookings.businessId), eq(inspectionResults.bookingId, bookings.id)),
    )
    .where(and(eq(bookings.publicToken, token), isNull(businesses.deletedAt), notInArray(bookings.status, ['cancelled'])));
  if (!b?.overall) throw notFound('Report');

  const settings = reportSettings((b.business.settings ?? {}) as Record<string, unknown>);
  const [rows, fields, photos] = await Promise.all([
    checksWithOutcomes(db, b.businessId, b.resultId),
    db
      .select({ key: bookingFields.fieldKey, label: bookingFields.label })
      .from(bookingFields)
      .where(and(eq(bookingFields.businessId, b.businessId), eq(bookingFields.isActive, true), eq(bookingFields.showToStaff, true)))
      .orderBy(asc(bookingFields.sortOrder), asc(bookingFields.id)),
    settings.reportPhotos
      ? db
          .select({ fileKey: bookingAttachments.fileKey, caption: bookingAttachments.caption })
          .from(bookingAttachments)
          .where(and(eq(bookingAttachments.businessId, b.businessId), eq(bookingAttachments.bookingId, b.id)))
          .orderBy(asc(bookingAttachments.createdAt), asc(bookingAttachments.id))
      : Promise.resolve([]),
  ]);

  const checked = rows.filter((r) => r.outcome !== null);
  const counts = Object.fromEntries(CHECK_OUTCOMES.map((o) => [o, checked.filter((r) => r.outcome === o).length])) as Record<
    CheckOutcome,
    number
  >;
  const answers = b.customFields as Record<string, string | number>;
  const store = photos.length ? requireStorage(storage) : null;
  const { settings: _s, ...business } = b.business;

  return {
    ref: bookingRef(b.token),
    business,
    serviceName: b.serviceName,
    startAt: b.startAt.toISOString(),
    completedAt: b.completedAt?.toISOString() ?? null,
    details: fields
      .filter((f) => answers[f.key] !== undefined && answers[f.key] !== '')
      .map((f) => ({ label: f.label, value: String(answers[f.key]) })),
    overall: b.overall as OverallResult,
    notes: b.resultNotes,
    counts,
    sections: groupSections(checked, (r) => ({ label: r.label, outcome: r.outcome as CheckOutcome, note: r.note })).map(
      ({ name, items }) => ({ name, items }),
    ),
    // The staff login linked to the bay / inspector; else the resource name (e.g. "Inspector Hafiz").
    inspectorName: settings.reportInspectorName ? (b.inspectorName ?? b.resourceName) : null,
    photos: store
      ? await Promise.all(photos.map(async (p) => ({ url: await store.signedUrl(p.fileKey, PHOTO_LINK_TTL_SEC), caption: p.caption })))
      : [],
  };
}
