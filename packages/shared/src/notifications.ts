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
