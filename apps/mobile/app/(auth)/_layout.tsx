import { Redirect, Stack } from 'expo-router';
import { authClient } from '@/lib/auth-client';
import { LoadingState } from '@/components/ui/ScreenState';
import { colors } from '@/theme';

export default function AuthLayout() {
  const session = authClient.useSession();
  if (session.isPending) return <LoadingState />;
  // Already logged in → role router
  if (session.data) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
