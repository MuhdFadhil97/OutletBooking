import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import type { MemberRole } from '@outletbooking/shared';
import { ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { useMe } from '@/features/me/hooks';

/** Keeps each tab group to its role; anyone else is sent back to the role router. */
export function RoleGate({ role, children }: { role: MemberRole; children: ReactNode }) {
  const { me, isLoading, isSignedOut, error, refetch } = useMe();
  if (isSignedOut) return <Redirect href="/login" />;
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!me || me.role !== role) return <Redirect href="/" />;
  return <>{children}</>;
}
