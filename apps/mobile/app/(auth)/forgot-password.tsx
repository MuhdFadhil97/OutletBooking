import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Brand } from '@/components/Brand';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { t } from '@/strings/en';

/** Placeholder until email delivery is set up. */
export default function ForgotPasswordScreen() {
  return (
    <SafeAreaView className="flex-1 gap-6 bg-bg px-5 pt-6">
      <Brand />
      <Card className="gap-4 p-5">
        <Text className="text-[22px] font-extrabold">{t.forgot.title}</Text>
        <Text className="text-[15px] text-muted">{t.forgot.body}</Text>
        <Button variant="secondary" title={t.forgot.backToLogin} onPress={() => router.back()} />
      </Card>
    </SafeAreaView>
  );
}
