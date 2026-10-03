import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import type { MemberRole } from '@outletbooking/shared';
import { ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { isOnboardingPending } from '@/features/auth/onboarding';
import { useMe } from '@/features/me/hooks';

/** Keeps each tab group to its role; anyone else is sent back to the role router. */
export function RoleGate({
  role,
  children,
  allowOnboarding,
}: {
  role: MemberRole;
  children: ReactNode;
  /** The step 3 screen itself. */
  allowOnboarding?: boolean;
}) {
  const { me, isLoading, isSignedOut, error, refetch } = useMe();
  if (isSignedOut) return <Redirect href="/login" />;
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!me || me.role !== role) return <Redirect href="/" />;
  // A new owner who has not finished sign-up step 3 is sent back to it from any owner screen.
  if (role === 'owner' && !allowOnboarding && isOnboardingPending()) return <Redirect href="/welcome" />;
  return <>{children}</>;
}
