import { z } from 'zod';
import { localDate } from './availability';
import type { Booking } from './bookings';
import type { HoursRow } from './hours';

/**
 * Staff app (Phase 6): S1 today, G2 my schedule, G3 my hours, S2 result notes + photos.
 */

/** G2 / S1: local dates [from, to), at most 31 days. */
export const myScheduleQuery = z
  .object({ from: localDate, to: localDate })
  .refine((q) => q.to > q.from, { message: '`to` must be after `from`', path: ['to'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= 31, {
    message: 'At most 31 days',
    path: ['to'],
  });
export type MyScheduleQuery = z.infer<typeof myScheduleQuery>;

/** A day off or closure that overlaps the range (resourceId null = whole business closed). */
export interface MyTimeOff {
  resourceId: number | null;
  startAt: string;
  endAt: string;
  reason: string | null;
}

/**
 * The signed-in member's own schedule: resources linked to their login, those resources'
 * weekly hours, time off, and bookings on them (even for staff who may "view all").
 */
export interface MySchedule {
  timezone: string;
  resources: { id: number; name: string }[];
  hours: HoursRow[];
  timeOff: MyTimeOff[];
  bookings: Booking[];
}

/** S2 result notes (inspection result, viewing feedback…). Empty text clears them. */
export const bookingResultSchema = z.object({
  resultNotes: z
    .string()
    .trim()
    .max(4000)
    .transform((s) => (s === '' ? null : s))
    .nullable(),
});
export type BookingResultInput = z.infer<typeof bookingResultSchema>;

/** S2 photos. HEIC is what iPhones take by default. */
export const ATTACHMENT_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export type AttachmentContentType = (typeof ATTACHMENT_CONTENT_TYPES)[number];
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENTS_PER_BOOKING = 20;

export interface BookingAttachment {
  id: number;
  contentType: string;
  caption: string | null;
  /** Short-lived signed link to the file. */
  url: string;
  uploadedBy: { id: number; name: string } | null;
  createdAt: string;
}

export const attachmentParam = z.object({
  id: z.coerce.number().int().positive(),
  attachmentId: z.coerce.number().int().positive(),
});
