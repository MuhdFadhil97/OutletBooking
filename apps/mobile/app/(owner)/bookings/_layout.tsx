import { Stack } from 'expo-router';
import { colors } from '@/theme';

/** Bookings tab: search list + pushed booking detail and reschedule form. */
export default function BookingsLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
