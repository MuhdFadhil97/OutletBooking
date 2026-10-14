import { Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SUPPORT_WHATSAPP } from '@outletbooking/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useLogout } from '@/features/auth/hooks';
import { whatsappUrl } from '@/features/bookings/format';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.suspended;

/**
 * Shown to the owner and staff in place of the whole app while FTech has the business suspended for misuse (I2).
 * The API refuses every business route until the suspension is lifted.
 */
export function Suspended({ businessName, reason }: { businessName: string; reason: string }) {
  const logout = useLogout();
  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="grow justify-center gap-3.5 p-6">
        <View className="h-[72px] w-[72px] items-center justify-center self-center rounded-full bg-danger-tint">
          <Icon name="lock" size={32} color={colors.danger} />
        </View>
        <Text className="text-center text-[24px] font-extrabold" accessibilityRole="header">
          {s.title}
        </Text>
        <Text className="text-center text-[15px] leading-[22px] text-muted">{s.body(businessName)}</Text>
        <Card className="gap-1 px-3.5 py-3">
          <Text className="text-[13px] font-bold text-muted">{s.reason}</Text>
          <Text className="text-[15px] leading-[22px]">{reason}</Text>
        </Card>
        <Text className="text-center text-[14px] leading-[20px] text-muted">{s.safe}</Text>
        <View className="h-2" />
        <Button
          title={s.whatsapp}
          onPress={() => void Linking.openURL(`${whatsappUrl(SUPPORT_WHATSAPP)}?text=${encodeURIComponent(s.whatsappMessage(businessName))}`)}
        />
        <Button variant="secondary" title={t.common.logout} loading={logout.isPending} onPress={() => logout.mutate()} className="border-0 bg-transparent" />
      </ScrollView>
    </SafeAreaView>
  );
}
