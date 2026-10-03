import { Stack } from 'expo-router';
import { colors } from '@/theme';

/** Setup tab: menu + pushed editors (each screen draws its own header). */
export default function SetupLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
