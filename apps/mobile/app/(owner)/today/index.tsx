import { useCallback } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { formatInTimeZone } from 'date-fns-tz';
import type { Booking, SetupStep } from '@outletbooking/shared';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Tag, type TagTone } from '@/components/ui/Tag';
import { Text } from '@/components/ui/Text';
import { shiftDate, todayIn } from '@/features/bookings/format';
import { useDayBookingsAll } from '@/features/bookings/hooks';
import { openBooking, openBookingForm } from '@/features/bookings/nav';
import { useMe } from '@/features/me/hooks';
import { BellButton } from '@/features/notifications/components/BellButton';
import { SetupChecklistCard } from '@/features/onboarding/components/SetupChecklistCard';
import { useSetupChecklist, useUpdateChecklist } from '@/features/onboarding/hooks';
import { confirm } from '@/lib/confirm';
import { bookingUrl } from '@/lib/config';
import { formatRM } from '@/lib/format';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const UP_NEXT_MAX = 5;

/** O2 · Today dashboard: trial countdown, D8 setup checklist (first weeks), today's numbers, quick actions, up next. */
export default function OwnerTodayScreen() {
  const { me, isLoading, error, refetch, isRefetching } = useMe();
  const tz = me?.business.timezone ?? 'Asia/Kuala_Lumpur';
  const date = todayIn(tz);
  const day = useDayBookingsAll(date, shiftDate(date, 1));
  const checklist = useSetupChecklist();
  const updateChecklist = useUpdateChecklist();

  useFocusEffect(
    useCallback(() => {
      void day.refetch();
      void checklist.refetch(); // steps done on other screens (hours, first booking)
    }, [day.refetch, checklist.refetch]), // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (isLoading) return <LoadingState />;
  if (error || !me) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const { business, subscription } = me;
  const todayLabel = formatInTimeZone(new Date(), business.timezone, 'EEE, d MMM yyyy');
  const link = bookingUrl(business.slug);
  const shareLink = async () => {
    try {
      const result = await Share.share({ message: t.today.shareMessage(business.name, link) });
      if (result.action === Share.sharedAction) updateChecklist.mutate({ linkShared: true });
    } catch {
      // Share sheet unavailable (some browsers) — nothing to record.
    }
  };
  const onChecklistStep = (step: SetupStep) => {
    if (step === 'resources') router.push('/setup/resources');
    else if (step === 'payments') router.push('/setup/payments');
    else if (step === 'shareLink') void shareLink();
    else if (step === 'testBooking') void Linking.openURL(link);
  };
  const hideChecklist = async () => {
    if (await confirm(t.today.checklist.hideTitle, t.today.checklist.hideBody, t.today.checklist.hide)) {
      updateChecklist.mutate({ hide: true });
    }
  };

  const actions: { label: string; icon: IconName; onPress: () => void }[] = [
    { label: t.today.newBooking, icon: 'plus', onPress: () => openBookingForm('today', { date }) },
    { label: t.today.walkIn, icon: 'walk', onPress: () => openBookingForm('today', { walkIn: '1' }) },
    { label: t.today.shareLink, icon: 'share', onPress: () => void shareLink() },
  ];

  const all = day.data ?? [];
  const counted = all.filter((b) => b.status !== 'cancelled' && b.status !== 'no_show');
  const kpis = [
    { value: String(counted.length), label: t.today.bookingsToday },
    { value: formatRM(counted.reduce((sum, b) => sum + b.priceSen, 0)), label: t.today.expectedRevenue },
    { value: String(all.filter((b) => b.status === 'checked_in' || b.status === 'completed').length), label: t.today.checkedIn },
    { value: String(all.filter((b) => b.status === 'no_show').length), label: t.today.noShow },
  ];
  const now = Date.now();
  const upNext = all
    .filter((b) => ['pending', 'confirmed', 'checked_in'].includes(b.status) && new Date(b.endAt).getTime() > now)
    .slice(0, UP_NEXT_MAX);

  const refresh = () => {
    void refetch();
    void day.refetch();
    void checklist.refetch();
  };

  let upNextBody;
  if (day.error && !day.data) {
    upNextBody = <ErrorState error={day.error} onRetry={() => void day.refetch()} />;
  } else if (!day.data) {
    upNextBody = <LoadingState />;
  } else if (upNext.length) {
    upNextBody = upNext.map((b, i) => <UpNextRow key={b.id} b={b} tz={business.timezone} first={i === 0} />);
  } else if (counted.length) {
    upNextBody = (
      <EmptyState icon={<Icon name="check" size={32} color={colors.muted} />} title={t.today.nothingNext} body={t.today.nothingNextBody} />
    );
  } else {
    upNextBody = (
      <EmptyState
        icon={<Icon name="calendar" size={32} color={colors.muted} />}
        title={t.today.emptyTitle}
        body={t.today.emptyBody}
        action={
          <Pressable onPress={() => void shareLink()} className="mt-1 min-h-[44px] justify-center">
            <Text className="text-[14px] font-bold text-primary">{t.today.shareLink}</Text>
          </Pressable>
        }
      />
    );
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      <ScrollView
        contentContainerClassName="gap-4 px-4 pb-8 pt-3"
        refreshControl={<RefreshControl refreshing={isRefetching || day.isRefetching} onRefresh={refresh} tintColor={colors.primary} />}
      >
        <View className="flex-row items-start gap-3">
          <View className="flex-1 gap-0.5">
            <Text className="text-[13px] font-semibold text-muted">{todayLabel}</Text>
            <Text className="text-[24px] font-extrabold">{business.name}</Text>
          </View>
          <BellButton onPress={() => router.push('/today/notifications')} />
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

        {checklist.data && !checklist.data.hidden ? (
          <SetupChecklistCard
            checklist={checklist.data}
            resourceLabel={business.resourceLabel}
            onPressStep={onChecklistStep}
            onHide={() => void hideChecklist()}
          />
        ) : null}

        <View className="flex-row flex-wrap gap-2.5">
          {kpis.map((k) => (
            <Card key={k.label} className="basis-[48%] grow gap-0.5 p-3">
              <Text className="text-[22px] font-extrabold">{day.data ? k.value : '–'}</Text>
              <Text className="text-[12px] font-semibold text-muted">{k.label}</Text>
            </Card>
          ))}
        </View>

        <View className="flex-row gap-2.5">
          {actions.map((a) => (
            <Pressable
              key={a.label}
              onPress={a.onPress}
              accessibilityRole="button"
              className="h-[76px] flex-1 items-center justify-center gap-1.5 rounded-card border border-border bg-card active:bg-pressed"
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
        <Card className="overflow-hidden">{upNextBody}</Card>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Payment / progress tag for the Up next list (wireframe: Paid, Awaiting payment). */
function upNextTag(b: Booking): { label: string; tone: TagTone } | null {
  if (b.status === 'checked_in') return { label: t.booking.status.checked_in, tone: 'info' };
  if (b.paymentStatus === 'paid') return { label: t.booking.paid, tone: 'ok' };
  if (b.paymentStatus === 'unpaid' && b.amountDueSen > 0) return { label: t.today.awaitingPayment, tone: 'pending' };
  if (b.source === 'walk_in') return { label: t.calendar.walkIn, tone: 'info' };
  return null;
}

function UpNextRow({ b, tz, first }: { b: Booking; tz: string; first: boolean }) {
  const start = new Date(b.startAt);
  const tag = upNextTag(b);
  return (
    <Pressable
      onPress={() => openBooking('today', b.id)}
      accessibilityRole="button"
      className={`flex-row items-center gap-3 px-3.5 py-3 active:bg-pressed ${first ? '' : 'border-t border-border'}`}
    >
      <View className="w-12 items-center">
        <Text className="text-[15px] font-extrabold">{formatInTimeZone(start, tz, 'h:mm')}</Text>
        <Text className="text-[11px] font-semibold text-muted">{formatInTimeZone(start, tz, 'a')}</Text>
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-[14px] font-bold" numberOfLines={1}>
          {b.customer.name}
        </Text>
        <Text className="text-[12px] text-muted" numberOfLines={1}>
          {b.resource.name} · {t.today.hours(b.durationMin)}
        </Text>
      </View>
      {tag ? <Tag label={tag.label} tone={tag.tone} /> : null}
    </Pressable>
  );
}
