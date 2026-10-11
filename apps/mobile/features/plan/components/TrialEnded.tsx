import { Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { SUPPORT_WHATSAPP } from '@outletbooking/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useLogout } from '@/features/auth/hooks';
import { whatsappUrl } from '@/features/bookings/format';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.trialEnded;

/**
 * E4 · Trial ended paywall (shown in place of Today). The other tabs stay open to look at;
 * the API refuses changes until a plan is paid (FR-16.3).
 */
export function TrialEnded({ businessName }: { businessName: string }) {
  const logout = useLogout();
  const points: { icon: IconName; title: string; body: string }[] = [
    { icon: 'pause', title: s.pausedTitle, body: s.pausedBody },
    { icon: 'lock', title: s.safeTitle, body: s.safeBody },
    { icon: 'calendar', title: s.viewTitle, body: s.viewBody },
  ];
  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="grow justify-center gap-3.5 p-6">
        <View className="h-[72px] w-[72px] items-center justify-center self-center rounded-full bg-pend-bg">
          <Icon name="clock" size={32} color={colors['pend-fg']} />
        </View>
        <Text className="text-center text-[24px] font-extrabold" accessibilityRole="header">
          {s.title}
        </Text>
        <Text className="text-center text-[15px] leading-[22px] text-muted">{s.body}</Text>
        <Card className="py-1">
          {points.map((p, i) => (
            <View key={p.title} className={`flex-row items-start gap-3 px-3.5 py-3 ${i ? 'border-t border-border' : ''}`}>
              <Icon name={p.icon} size={20} color={colors.primary} />
              <Text className="flex-1 text-[14px] leading-[20px]">
                <Text className="text-[14px] font-bold">{p.title}</Text>
                {p.body}
              </Text>
            </View>
          ))}
        </Card>
        <View className="h-2" />
        <Button title={s.choosePlan} onPress={() => router.push('/setup/plan')} />
        <Button
          variant="secondary"
          title={s.whatsapp}
          onPress={() => void Linking.openURL(`${whatsappUrl(SUPPORT_WHATSAPP)}?text=${encodeURIComponent(s.whatsappMessage(businessName))}`)}
        />
        <Button variant="secondary" title={t.common.logout} loading={logout.isPending} onPress={() => logout.mutate()} className="border-0 bg-transparent" />
      </ScrollView>
    </SafeAreaView>
  );
}
