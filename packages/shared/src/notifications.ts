import { z } from 'zod';

/** In-app notifications (D6). Each row also goes out as an Expo push to the recipient's devices. */
export const NOTIFICATION_TYPES = [
  'booking_new',
  'booking_paid',
  'payment_failed',
  'booking_cancelled',
  'walk_in',
  'staff_joined',
  'reminders_sent',
  'trial_ending',
  'trial_ended',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface AppNotification {
  id: number;
  type: NotificationType;
  title: string;
  body: string | null;
  /** Opens the booking when tapped. */
  bookingId: number | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationList {
  items: AppNotification[];
  unreadCount: number;
}

export const notificationListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Mark these as read; omit `ids` for "Mark all read". */
export const notificationReadSchema = z.object({
  ids: z.array(z.number().int().positive()).max(100).optional(),
});
export type NotificationRead = z.infer<typeof notificationReadSchema>;

/**
 * G3 push switches. Off = no push for those types (the D6 list still keeps them).
 * Types not listed here (trial, staff joined, …) always push.
 */
export const NOTIFICATION_PREF_KEYS = ['newBookings', 'changes', 'daySummary'] as const;
export type NotificationPrefKey = (typeof NOTIFICATION_PREF_KEYS)[number];
export type NotificationPrefs = Record<NotificationPrefKey, boolean>;

export const NOTIFICATION_PREF_FOR_TYPE: Partial<Record<NotificationType, NotificationPrefKey>> = {
  booking_new: 'newBookings',
  booking_paid: 'newBookings',
  walk_in: 'newBookings',
  booking_cancelled: 'changes',
  payment_failed: 'changes',
};

/** Stored prefs → every switch (missing = on). */
export const resolveNotificationPrefs = (stored: Partial<Record<string, boolean>> | null | undefined): NotificationPrefs => ({
  newBookings: stored?.newBookings ?? true,
  changes: stored?.changes ?? true,
  daySummary: stored?.daySummary ?? true,
});

export const notificationPrefsSchema = z
  .object({ newBookings: z.boolean(), changes: z.boolean(), daySummary: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export type NotificationPrefsUpdate = z.infer<typeof notificationPrefsSchema>;
