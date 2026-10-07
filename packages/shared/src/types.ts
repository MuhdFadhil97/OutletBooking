import type { BusinessTemplate } from './templates';

export type MemberRole = 'owner' | 'staff';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'expired' | 'cancelled';

export interface MeResponse {
  user: { id: number; name: string; email: string; phone: string | null };
  business: {
    slug: string;
    name: string;
    template: BusinessTemplate;
    resourceLabel: string;
    timezone: string;
  };
  role: MemberRole;
  /** Owners have all of them. The API enforces these; the app uses them to show / hide actions. */
  permissions: { canViewAll: boolean; canTakePayments: boolean; canEditSetup: boolean };
  subscription: {
    plan: 'trial' | 'starter' | 'business';
    status: SubscriptionStatus;
    trialEndsAt: string; // ISO
    trialDaysLeft: number; // 0 when ended
    isTrialActive: boolean;
  };
}

export interface SlugAvailabilityResponse {
  slug: string;
  available: boolean;
  reason?: 'invalid' | 'taken';
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

// ------------------------------------------------------------ D6 notifications

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
  bookingId: number | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationList {
  items: AppNotification[];
  unread: number;
}
