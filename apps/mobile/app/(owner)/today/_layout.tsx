import { Stack } from 'expo-router';
import { colors } from '@/theme';

/** Today tab: dashboard + pushed booking detail, new booking and walk-in form. */
export default function TodayLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
