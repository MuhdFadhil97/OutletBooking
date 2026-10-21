import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Brand } from '@/components/Brand';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useLogout } from '@/features/auth/hooks';
import { t } from '@/strings/en';

/** Shown on /signup when the visitor already has a session (instead of a silent jump to the dashboard). */
export function AlreadySignedIn({ email }: { email: string }) {
  const logout = useLogout();
  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 gap-5 px-5 pt-6">
        <Brand />
        <Text className="text-[22px] font-extrabold">{t.signup.alreadyTitle}</Text>
        <Text className="text-[14px] text-muted">{t.signup.alreadyBody(email)}</Text>
        <Button title={t.signup.alreadyGo} onPress={() => router.replace('/')} />
        <Button variant="secondary" title={t.signup.alreadyLogout} loading={logout.isPending} onPress={() => logout.mutate()} />
      </View>
    </SafeAreaView>
  );
}
