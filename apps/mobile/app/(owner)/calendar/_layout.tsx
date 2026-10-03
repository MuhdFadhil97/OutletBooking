import { Stack } from 'expo-router';
import { colors } from '@/theme';

/** Calendar tab: day/week view + pushed booking detail and booking form. */
export default function CalendarLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
