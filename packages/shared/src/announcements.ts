import { z } from 'zod';
import { BUSINESS_TEMPLATES } from './templates';

/**
 * I28 · Announcements to owners (docs/wireframes/Admin-Announce.dc.html): service messages only — maintenance, price and
 * feature changes. By email, an in-app banner at the top of Today (O2) and/or push. Marketing needs the owner's consent,
 * so it does not belong here. Super admins only.
 */

export const ANNOUNCEMENT_TYPES = ['maintenance', 'price_change', 'feature_change', 'other'] as const;
export type AnnouncementType = (typeof ANNOUNCEMENT_TYPES)[number];

/** All owners · by plan · by business type · one business. */
export const ANNOUNCEMENT_AUDIENCES = ['all', 'plan', 'template', 'business'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const ANNOUNCEMENT_CHANNELS = ['email', 'in_app', 'push'] as const;
export type AnnouncementChannel = (typeof ANNOUNCEMENT_CHANNELS)[number];

/** Plan codes an announcement can target (the trial counts as a plan here). */
export const ANNOUNCEMENT_PLANS = ['trial', 'starter', 'business'] as const;

export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 1000;

export const createAnnouncementSchema = z
  .object({
    type: z.enum(ANNOUNCEMENT_TYPES),
    audience: z.enum(ANNOUNCEMENT_AUDIENCES),
    /** Plan code, business type, or the booking page link (slug) of one business; empty for "all owners". */
    audienceValue: z.string().trim().min(1).max(100).optional(),
    channels: z
      .array(z.enum(ANNOUNCEMENT_CHANNELS))
      .min(1, 'Pick at least one way to send it')
      .transform((c) => [...new Set(c)]),
    title: z.string().trim().min(3, 'Add a title').max(ANNOUNCEMENT_TITLE_MAX),
    body: z.string().trim().min(3, 'Write the message').max(ANNOUNCEMENT_BODY_MAX),
    /** Omit to send now. */
    sendAt: z.iso.datetime().optional(),
    /** The banner is hidden after this. Omit to keep it until each owner dismisses it. */
    endsAt: z.iso.datetime().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.audience === 'all') {
      if (v.audienceValue !== undefined) ctx.addIssue({ code: 'custom', path: ['audienceValue'], message: 'All owners needs no value' });
    } else if (v.audienceValue === undefined) {
      ctx.addIssue({ code: 'custom', path: ['audienceValue'], message: 'Pick who should get it' });
    } else if (v.audience === 'plan' && !(ANNOUNCEMENT_PLANS as readonly string[]).includes(v.audienceValue)) {
      ctx.addIssue({ code: 'custom', path: ['audienceValue'], message: 'Unknown plan' });
    } else if (v.audience === 'template' && !(BUSINESS_TEMPLATES as readonly string[]).includes(v.audienceValue)) {
      ctx.addIssue({ code: 'custom', path: ['audienceValue'], message: 'Unknown business type' });
    }
    if (v.endsAt && v.sendAt && Date.parse(v.endsAt) <= Date.parse(v.sendAt)) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'The end date must be after the send time' });
    }
    if (v.endsAt && !v.channels.includes('in_app')) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'An end date only applies to the in-app banner' });
    }
  });
export type CreateAnnouncementInput = z.input<typeof createAnnouncementSchema>;
export type CreateAnnouncement = z.output<typeof createAnnouncementSchema>;

export const announcementAudienceQuery = z.object({
  audience: z.enum(ANNOUNCEMENT_AUDIENCES),
  value: z.string().trim().max(100).optional(),
});

/** Scheduled = not sent yet · Sent = delivered (banner still showing) · Ended = banner end date passed. */
export type AnnouncementStatus = 'scheduled' | 'sent' | 'ended';

export interface AnnouncementRow {
  id: number;
  type: AnnouncementType;
  audience: AnnouncementAudience;
  audienceValue: string | null;
  channels: AnnouncementChannel[];
  title: string;
  body: string;
  sendAt: string;
  endsAt: string | null;
  sentAt: string | null;
  /** Owners reached. */
  sentCount: number;
  status: AnnouncementStatus;
  createdBy: string | null;
}

/** "Schedule · 23 owners": how many owners an audience reaches today. */
export interface AnnouncementAudienceCount {
  owners: number;
}

/** The in-app banner on Today (O2). */
export interface ActiveAnnouncement {
  id: number;
  type: AnnouncementType;
  title: string;
  body: string;
}

export function announcementStatus(
  a: { sentAt: Date | string | null; endsAt: Date | string | null },
  now: Date = new Date(),
): AnnouncementStatus {
  if (!a.sentAt) return 'scheduled';
  if (a.endsAt && new Date(a.endsAt).getTime() <= now.getTime()) return 'ended';
  return 'sent';
}
