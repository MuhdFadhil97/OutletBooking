import { z } from 'zod';
import { adminReason } from './admin';
import { emailSchema, phoneE164 } from './schemas';

/**
 * I25 · Privacy requests (PDPA): access, correction, deletion, portability, stop marketing.
 * FTech answers owners', staff and visitors' requests itself. A customer's request is about the business's data:
 * it is passed to the business and the case stays open until they confirm (docs/wireframes/Admin-Privacy.dc.html).
 */

export const PRIVACY_KINDS = ['access', 'correction', 'deletion', 'portability', 'stop_marketing', 'other'] as const;
export type PrivacyKind = (typeof PRIVACY_KINDS)[number];

export const PRIVACY_REQUESTERS = ['owner', 'staff', 'customer', 'visitor'] as const;
export type PrivacyRequester = (typeof PRIVACY_REQUESTERS)[number];

export const PRIVACY_STATUSES = ['open', 'waiting_id_check', 'in_progress', 'sent_to_business', 'done', 'rejected'] as const;
export type PrivacyStatus = (typeof PRIVACY_STATUSES)[number];

/** A request that is finished (closed_at set). */
export const PRIVACY_CLOSED_STATUSES: readonly PrivacyStatus[] = ['done', 'rejected'];

/** The four steps on the request, in order (the wireframe's checklist). */
export const PRIVACY_CHECKLIST = ['logged', 'id_checked', 'change_made', 'replied'] as const;
export type PrivacyChecklistStep = (typeof PRIVACY_CHECKLIST)[number];

/** PDPA: 21 days to answer an access or correction request; one extension of 14 days with a reason. */
export const PRIVACY_DUE_DAYS = 21;
export const PRIVACY_EXTENSION_DAYS = 14;
/** "Due soon" on the list and the KPI = due within this many days (overdue ones too). */
export const PRIVACY_DUE_SOON_DAYS = 3;

export const PRIVACY_TABS = ['open', 'due_soon', 'done', 'all'] as const;
export type PrivacyTab = (typeof PRIVACY_TABS)[number];

export const privacyListQuery = z.object({
  tab: z.enum(PRIVACY_TABS).default('open'),
  q: z.string().trim().max(100).optional(),
});
export type PrivacyListQuery = z.infer<typeof privacyListQuery>;

/** "Log a request": who asked, what, and how to reach them (an email or a mobile number). */
export const createPrivacyRequestSchema = z
  .object({
    requesterName: z.string().trim().min(2, 'Enter who is asking').max(200),
    requesterKind: z.enum(PRIVACY_REQUESTERS),
    kind: z.enum(PRIVACY_KINDS),
    requesterEmail: emailSchema.optional(),
    requesterPhone: phoneE164.optional(),
    /** The business the data belongs to (required to pass a customer's request on). */
    businessId: z.number().int().positive().optional(),
    /** When it arrived, if not today (the 21 days count from here). */
    receivedOn: z.iso.date().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.requesterEmail !== undefined || v.requesterPhone !== undefined, {
    message: 'Add an email or a mobile number to reach them',
    path: ['requesterEmail'],
  });
export type CreatePrivacyRequestInput = z.input<typeof createPrivacyRequestSchema>;

export const setPrivacyStatusSchema = z.object({
  status: z.enum(PRIVACY_STATUSES),
  /** Needed to reject a request (what was said to the person). */
  reason: adminReason.optional(),
});
export const setPrivacyChecklistSchema = z.object({ step: z.enum(PRIVACY_CHECKLIST), done: z.boolean() });
export const setPrivacyNotesSchema = z.object({ notes: z.string().trim().max(2000) });
export const extendPrivacySchema = z.object({ reason: adminReason });

export interface PrivacyRequestRow {
  id: number;
  receivedAt: string;
  requesterName: string;
  requesterKind: PrivacyRequester;
  kind: PrivacyKind;
  status: PrivacyStatus;
  business: { id: number; name: string } | null;
  dueAt: string;
  closedAt: string | null;
}

export interface PrivacyRequestDetail extends PrivacyRequestRow {
  requesterEmail: string | null;
  requesterPhone: string | null;
  extendedReason: string | null;
  checklist: Record<PrivacyChecklistStep, boolean>;
  notes: string | null;
  handledBy: { id: number; name: string } | null;
}

export interface PrivacySummary {
  /** Not finished. */
  open: number;
  /** Not finished and due within PRIVACY_DUE_SOON_DAYS (not yet overdue). */
  dueSoon: number;
  overdue: number;
}

/** Whole Malaysia calendar days from `now` to the deadline: 0 = today, negative = overdue. */
export function privacyDaysLeft(dueAt: Date | string, now: Date = new Date()): number {
  const day = (d: Date) =>
    Date.parse(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)}T00:00:00Z`);
  return Math.round((day(new Date(dueAt)) - day(now)) / 86_400_000);
}
