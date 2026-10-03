import { useQuery } from '@tanstack/react-query';
import { authClient } from '@/lib/auth-client';
import { getMe } from './api';

/**
 * Current user + business + role + trial. Only runs when a session exists.
 * `isSignedOut` is true when there is no session (→ go to login).
 */
export function useMe() {
  const session = authClient.useSession();
  const hasSession = !!session.data;
  const query = useQuery({ queryKey: ['me'], queryFn: getMe, enabled: hasSession });

  return {
    ...query,
    me: query.data,
    sessionPending: session.isPending,
    isSignedOut: !session.isPending && !hasSession,
    isLoading: session.isPending || (hasSession && query.isPending),
  };
}
