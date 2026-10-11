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
    /** Trial running or plan paid: false = booking page paused, app view only (FR-16.3). */
    hasAccess: boolean;
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
