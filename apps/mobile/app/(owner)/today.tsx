import { Pressable, RefreshControl, ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { formatInTimeZone } from 'date-fns-tz';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { useMe } from '@/features/me/hooks';
import { bookingUrl } from '@/lib/config';
import { t } from '@/strings/en';
import { colors } from '@/theme';

/** O2 · Today dashboard. Trial countdown is live; KPIs and "Up next" fill in from Phase 3. */
export default function OwnerTodayScreen() {
  const { me, isLoading, error, refetch, isRefetching } = useMe();

  if (isLoading) return <LoadingState />;
  if (error || !me) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const { business, subscription } = me;
  const today = formatInTimeZone(new Date(), business.timezone, 'EEE, d MMM yyyy');
  const link = bookingUrl(business.slug);
  const shareLink = () => void Share.share({ message: t.today.shareMessage(business.name, link) });

  const actions: { label: string; icon: IconName; onPress?: () => void }[] = [
    { label: t.today.newBooking, icon: 'plus' },
    { label: t.today.walkIn, icon: 'walk' },
    { label: t.today.shareLink, icon: 'share', onPress: shareLink },
  ];

  // Real numbers arrive with bookings in Phase 3.
  const kpis = [
    { value: '0', label: t.today.bookingsToday },
    { value: 'RM 0', label: t.today.expectedRevenue },
    { value: '0', label: t.today.checkedIn },
    { value: '0', label: t.today.noShow },
  ];

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      <ScrollView
        contentContainerClassName="gap-4 px-4 pb-8 pt-3"
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.primary} />}
      >
        <View className="gap-0.5">
          <Text className="text-[13px] font-semibold text-muted">{today}</Text>
          <Text className="text-[24px] font-extrabold">{business.name}</Text>
        </View>

        <View
          className={`flex-row items-center justify-between rounded-card px-3.5 py-3 ${
            subscription.isTrialActive ? 'bg-pend-bg' : 'bg-danger-tint'
          }`}
        >
          <View className="flex-row items-center gap-2">
            <Icon name="clock" size={18} color={subscription.isTrialActive ? colors['pend-fg'] : colors.danger} />
            <Text className={`text-[14px] font-bold ${subscription.isTrialActive ? 'text-pend-fg' : 'text-danger'}`}>
              {subscription.isTrialActive ? t.today.trial(subscription.trialDaysLeft) : t.today.trialEnded}
            </Text>
          </View>
          <Text className="text-[14px] font-bold text-primary">{t.today.choosePlan}</Text>
        </View>

        <View className="flex-row flex-wrap gap-2.5">
          {kpis.map((k) => (
            <Card key={k.label} className="basis-[48%] grow gap-0.5 p-3">
              <Text className="text-[22px] font-extrabold">{k.value}</Text>
              <Text className="text-[12px] font-semibold text-muted">{k.label}</Text>
            </Card>
          ))}
        </View>

        <View className="flex-row gap-2.5">
          {actions.map((a) => (
            <Pressable
              key={a.label}
              onPress={a.onPress}
              disabled={!a.onPress}
              accessibilityRole="button"
              accessibilityHint={a.onPress ? undefined : t.common.comingSoon}
              className={`h-[76px] flex-1 items-center justify-center gap-1.5 rounded-card border border-border bg-card active:bg-pressed ${
                a.onPress ? '' : 'opacity-50'
              }`}
            >
              <Icon name={a.icon} color={colors.text} />
              <Text className="text-[12px] font-bold">{a.label}</Text>
            </Pressable>
          ))}
        </View>

        <View className="flex-row items-center justify-between pt-1">
          <Text className="text-[17px] font-extrabold">{t.today.upNext}</Text>
          <Pressable onPress={() => router.push('/calendar')} className="min-h-[44px] justify-center">
            <Text className="text-[14px] font-bold text-primary">{t.today.seeCalendar}</Text>
          </Pressable>
        </View>
        <Card>
          <EmptyState
            icon={<Icon name="calendar" size={32} color={colors.muted} />}
            title={t.today.emptyTitle}
            body={t.today.emptyBody}
            action={
              <Pressable onPress={shareLink} className="mt-1 min-h-[44px] justify-center">
                <Text className="text-[14px] font-bold text-primary">{t.today.shareLink}</Text>
              </Pressable>
            }
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
