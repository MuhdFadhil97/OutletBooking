import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import type { MemberRole } from '@outletbooking/shared';
import { ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { isOnboardingPending } from '@/features/auth/onboarding';
import { useMe } from '@/features/me/hooks';
import { StaffLocked } from '@/features/plan/components/StaffLocked';
import { Suspended } from '@/features/plan/components/Suspended';

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
  // I2: suspended by FTech — the API refuses everything else, so show why instead of the tabs.
  if (me.business.suspendReason) return <Suspended businessName={me.business.name} reason={me.business.suspendReason} />;
  // The plan has no staff app (Starter): staff are hidden until the owner upgrades.
  if (me.staffLocked) return <StaffLocked businessName={me.business.name} />;
  // A new owner who has not finished sign-up step 3 is sent back to it from any owner screen.
  if (role === 'owner' && !allowOnboarding && isOnboardingPending()) return <Redirect href="/welcome" />;
  return <>{children}</>;
}
