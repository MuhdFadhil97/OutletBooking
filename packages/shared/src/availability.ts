import { z } from 'zod';

/** Local calendar date "YYYY-MM-DD" in the business timezone. */
export const localDate = z.iso.date();

/** Slot lookup: one service, one local date, optional duration option and resource ("any" when omitted). */
export const availabilityQuerySchema = z.object({
  serviceId: z.coerce.number().int().positive(),
  date: localDate,
  /** One of the service's duration options; defaults to the service duration. */
  durationMin: z.coerce.number().int().positive().optional(),
  /** Omit for "any available". */
  resourceId: z.coerce.number().int().positive().optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export interface AvailableSlot {
  /** ISO timestamps (UTC). Display in the business timezone. */
  startAt: string;
  endAt: string;
  /** Free resources for this slot, least busy that day first (FR-06.5: "any" takes the first). */
  resourceIds: number[];
}

export interface Availability {
  date: string;
  timezone: string;
  durationMin: number;
  slots: AvailableSlot[];
}
