import { z } from 'zod';
import { adminReason } from './admin';
import type { BusinessTemplate } from './templates';

/**
 * I26 · Data deletion (docs/wireframes/Admin-Deletion.dc.html, Terms and Privacy notice). A business that has had no plan
 * for 12 months gets the M7 notice and its data is deleted 30 days later; one that asked to close is deleted 90 days later.
 * An admin can put a business on hold (with a reason). Deleting removes the business's customers, bookings, staff accounts,
 * files and settings. FTech keeps its own plan payment and receipt records for 7 years (tax), with the business name only,
 * and the audit log of the deletion.
 */

/** Why a business is in the queue. */
export type DeletionReason = 'unpaid' | 'close_request';

export const DELETION_TABS = ['todo', 'notice_sent', 'on_hold', 'done'] as const;
export type DeletionTab = (typeof DELETION_TABS)[number];

/** Releasing a hold never leaves less than this many days before the business can be deleted. */
export const DELETION_RELEASE_MIN_DAYS = 7;
/** FTech's plan payment and receipt records are kept this many years (tax). */
export const DELETION_KEEP_RECORDS_YEARS = 7;

export const deletionQuery = z.object({ tab: z.enum(DELETION_TABS).default('todo') });
export type DeletionQuery = z.infer<typeof deletionQuery>;

export const holdDeletionSchema = z.object({ reason: adminReason });
export const closeBusinessSchema = z.object({ reason: adminReason });

export interface DeletionRow {
  id: number;
  name: string;
  template: BusinessTemplate;
  reason: DeletionReason;
  /** Unpaid: when the last plan or trial ended. Close request: when the owner asked. Done: null. */
  since: string | null;
  /** Months without a plan (unpaid only). */
  unpaidMonths: number | null;
  noticeSentAt: string | null;
  /** The day the daily job deletes it, unless it pays or is on hold. */
  deleteOn: string | null;
  holdReason: string | null;
  deletedAt: string | null;
  tab: DeletionTab;
}

export interface DeletionSummary {
  /** Unpaid 12 months, no notice sent yet. */
  noticeToSend: number;
  /** Deleting within the next 30 days (notice sent or close request), not on hold. */
  deletingSoon: number;
  onHold: number;
  deletedThisYear: number;
  /** False on a server where `DATA_DELETION_ENABLED` is not on: nothing is deleted automatically there. */
  autoDeleteEnabled: boolean;
}

export interface DeletionQueue {
  summary: DeletionSummary;
  rows: DeletionRow[];
}

/** What "Send notice" and the job learn about one business. */
export interface DeletionCounts {
  [table: string]: number;
}
