import { z } from 'zod';
import { LEAD_STATUSES, type LeadReason, type LeadStatus } from './website';

/**
 * I11 · Support: cases for FTech staff (notes about owner questions; replies to owners still go through
 * WhatsApp or email) and the website contact-form leads (I19).
 */

export const SUPPORT_STATUSES = ['open', 'waiting', 'closed'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_SOURCES = ['whatsapp', 'email', 'website', 'phone', 'other'] as const;
export type SupportSource = (typeof SUPPORT_SOURCES)[number];

/** `owner_message` = copied in from WhatsApp or email; `internal` = FTech's own note. */
export const SUPPORT_NOTE_KINDS = ['internal', 'owner_message'] as const;
export type SupportNoteKind = (typeof SUPPORT_NOTE_KINDS)[number];

/** Left tabs of I11. Website leads are their own list. */
export const SUPPORT_TABS = ['open', 'waiting', 'leads', 'closed'] as const;
export type SupportTab = (typeof SUPPORT_TABS)[number];

export const supportCasesQuery = z.object({
  status: z.enum(SUPPORT_STATUSES).default('open'),
  q: z.string().trim().max(100).optional(),
});
export type SupportCasesQuery = z.infer<typeof supportCasesQuery>;

export const supportLeadsQuery = z.object({
  /** Default: leads still being worked on (new + contacted). */
  status: z.enum([...LEAD_STATUSES, 'active']).default('active'),
  q: z.string().trim().max(100).optional(),
});
export type SupportLeadsQuery = z.infer<typeof supportLeadsQuery>;

export const createSupportCaseSchema = z.object({
  title: z.string().trim().min(3, 'Give the case a short title').max(200),
  source: z.enum(SUPPORT_SOURCES),
  businessId: z.number().int().positive().optional(),
  leadId: z.number().int().positive().optional(),
  /** First note (optional), e.g. what the owner wrote. */
  note: z.string().trim().max(2000).optional(),
  noteKind: z.enum(SUPPORT_NOTE_KINDS).default('internal'),
});
export type CreateSupportCaseInput = z.input<typeof createSupportCaseSchema>;

export const addSupportNoteSchema = z.object({
  body: z.string().trim().min(1, 'Write a note first').max(2000),
  kind: z.enum(SUPPORT_NOTE_KINDS).default('internal'),
});
export type AddSupportNoteInput = z.input<typeof addSupportNoteSchema>;

export const setSupportStatusSchema = z.object({ status: z.enum(SUPPORT_STATUSES) });
export const assignSupportCaseSchema = z.object({ adminUserId: z.number().int().positive().nullable() });
export const setLeadStatusSchema = z.object({ status: z.enum(LEAD_STATUSES) });

export interface SupportSummary {
  open: number;
  waiting: number;
  /** Leads still being worked on (new + contacted). */
  leads: number;
  /** New leads nobody has contacted yet. */
  newLeads: number;
  closed: number;
}

export interface SupportCaseRow {
  id: number;
  title: string;
  status: SupportStatus;
  source: SupportSource;
  business: { id: number; name: string } | null;
  fromLead: boolean;
  assignedTo: { id: number; name: string } | null;
  createdAt: string;
  /** Latest change or note. */
  updatedAt: string;
}

export interface SupportNote {
  id: number;
  kind: SupportNoteKind;
  body: string;
  /** Null when that admin was removed from the database. */
  admin: { id: number; name: string } | null;
  createdAt: string;
}

export interface SupportLead {
  id: number;
  reason: LeadReason;
  name: string;
  businessName: string | null;
  phone: string | null;
  email: string | null;
  businessType: string | null;
  resourceCount: string | null;
  message: string | null;
  status: LeadStatus;
  createdAt: string;
  /** A case already opened for this lead. */
  caseId: number | null;
}

export interface SupportCaseDetail extends SupportCaseRow {
  closedAt: string | null;
  /** Same facts as I2 shows (never payment details). */
  businessInfo: {
    id: number;
    name: string;
    ownerName: string | null;
    /** WhatsApp number, else business phone, else owner's mobile (E.164). */
    phone: string | null;
    trialEndsAt: string | null;
  } | null;
  lead: SupportLead | null;
  notes: SupportNote[];
}

export interface SupportLeadsResponse {
  leads: SupportLead[];
}
