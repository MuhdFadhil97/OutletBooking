import { boolean, check, foreignKey, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idPk, updatedAt } from './columns';
import { businesses } from './tenant';
import { bookings } from './bookings';

// Vehicle inspection checklist & report (ST-VI-C, S2) — docs/schema.sql section 7.

const businessId = () =>
  integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' });

export const checklistSections = pgTable(
  'checklist_sections',
  {
    id: idPk(),
    businessId: businessId(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('checklist_sections_business_id_id_key').on(t.businessId, t.id),
    index('checklist_sections_business_id_idx').on(t.businessId),
  ],
);

export const checklistItems = pgTable(
  'checklist_items',
  {
    id: idPk(),
    businessId: businessId(),
    sectionId: integer('section_id').notNull(),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Removed checks stay (old reports point at them) but are no longer asked. */
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('checklist_items_business_id_id_key').on(t.businessId, t.id),
    foreignKey({
      name: 'checklist_items_business_id_section_id_fkey',
      columns: [t.businessId, t.sectionId],
      foreignColumns: [checklistSections.businessId, checklistSections.id],
    }).onDelete('cascade'),
    index('checklist_items_business_id_idx').on(t.businessId),
    index('checklist_items_section_idx').on(t.sectionId),
  ],
);

/** One per inspected booking: overall result + notes; `report_sent_at` when the report link went out. */
export const inspectionResults = pgTable(
  'inspection_results',
  {
    id: idPk(),
    businessId: businessId(),
    bookingId: integer('booking_id').notNull(),
    overall: text('overall'),
    notes: text('notes'),
    reportSentAt: timestamp('report_sent_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('inspection_results_business_id_booking_id_key').on(t.businessId, t.bookingId),
    unique('inspection_results_business_id_id_key').on(t.businessId, t.id),
    foreignKey({
      name: 'inspection_results_business_id_booking_id_fkey',
      columns: [t.businessId, t.bookingId],
      foreignColumns: [bookings.businessId, bookings.id],
    }).onDelete('cascade'),
    index('inspection_results_business_id_idx').on(t.businessId),
    check('inspection_results_overall_check', sql`${t.overall} IN ('pass','attention','fail')`),
  ],
);

export const inspectionItemResults = pgTable(
  'inspection_item_results',
  {
    id: idPk(),
    businessId: businessId(),
    resultId: integer('result_id').notNull(),
    itemId: integer('item_id').notNull(),
    outcome: text('outcome').notNull(),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('inspection_item_results_result_id_item_id_key').on(t.resultId, t.itemId),
    foreignKey({
      name: 'inspection_item_results_business_id_result_id_fkey',
      columns: [t.businessId, t.resultId],
      foreignColumns: [inspectionResults.businessId, inspectionResults.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'inspection_item_results_business_id_item_id_fkey',
      columns: [t.businessId, t.itemId],
      foreignColumns: [checklistItems.businessId, checklistItems.id],
    }),
    index('inspection_item_results_business_id_idx').on(t.businessId),
    check('inspection_item_results_outcome_check', sql`${t.outcome} IN ('pass','attention','fail','na')`),
  ],
);
