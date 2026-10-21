import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useLogout } from '@/features/auth/hooks';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.staffLocked;

/**
 * Shown to a staff login in place of the staff app when the business's plan does not include it (Starter).
 * Their access is hidden, not removed: it returns when the owner upgrades.
 */
export function StaffLocked({ businessName }: { businessName: string }) {
  const logout = useLogout();
  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="grow justify-center gap-3.5 p-6">
        <View className="h-[72px] w-[72px] items-center justify-center self-center rounded-full bg-pend-bg">
          <Icon name="lock" size={32} color={colors['pend-fg']} />
        </View>
        <Text className="text-center text-[24px] font-extrabold" accessibilityRole="header">
          {s.title}
        </Text>
        <Text className="text-center text-[15px] leading-[22px] text-muted">{s.body(businessName)}</Text>
        <View className="h-2" />
        <Button variant="secondary" title={t.common.logout} loading={logout.isPending} onPress={() => logout.mutate()} />
      </ScrollView>
    </SafeAreaView>
  );
}
