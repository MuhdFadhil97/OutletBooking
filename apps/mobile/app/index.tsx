import { Redirect } from 'expo-router';
import { ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { useLogout } from '@/features/auth/hooks';
import { useMe } from '@/features/me/hooks';
import { ApiError } from '@/lib/api';

/** Entry: route by session + role. */
export default function Index() {
  const { me, isLoading, isSignedOut, error, refetch } = useMe();
  const logout = useLogout();

  if (isSignedOut) return <Redirect href="/login" />;
  if (isLoading) return <LoadingState />;
  if (error) {
    // Session expired / revoked → back to login
    if (error instanceof ApiError && error.status === 401) {
      logout.mutate();
      return <Redirect href="/login" />;
    }
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }
  if (!me) return <LoadingState />;
  return <Redirect href={me.role === 'owner' ? '/today' : '/staff/today'} />;
}
