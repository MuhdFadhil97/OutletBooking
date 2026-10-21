import { useRef } from 'react';
import { Redirect, Stack, useSegments } from 'expo-router';
import { AlreadySignedIn } from '@/components/AlreadySignedIn';
import { authClient } from '@/lib/auth-client';
import { LoadingState } from '@/components/ui/ScreenState';
import { colors } from '@/theme';

export default function AuthLayout() {
  const session = authClient.useSession();
  const segments: string[] = useSegments();
  // Whether the visitor opened the app already signed in. A session that appears while they are on
  // /signup (they just created the account) must still redirect to `/` → step 3.
  const arrivedSignedIn = useRef<boolean | null>(null);

  if (session.isPending) return <LoadingState />;
  if (arrivedSignedIn.current === null || !session.data) arrivedSignedIn.current = !!session.data;

  if (session.data) {
    // Signed in and tapped "Start free trial": explain instead of silently jumping to the dashboard.
    if (arrivedSignedIn.current && segments.includes('signup')) {
      return <AlreadySignedIn email={session.data.user.email} />;
    }
    // Otherwise → role router
    return <Redirect href="/" />;
  }
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
