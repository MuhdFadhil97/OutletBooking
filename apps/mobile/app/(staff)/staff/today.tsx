import { Fragment, useCallback } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { formatInTimeZone } from 'date-fns-tz';
import type { Booking } from '@outletbooking/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Tag } from '@/components/ui/Tag';
import { Text } from '@/components/ui/Text';
import { showToast } from '@/components/ui/Toast';
import { mapsUrl, shiftDate, statusTone, todayIn, wazeUrl, whatsappUrl } from '@/features/bookings/format';
import { useSetBookingStatus } from '@/features/bookings/hooks';
import { useMe } from '@/features/me/hooks';
import { firstAnswer, focusBookingId, formatIn, initials, useNow } from '@/features/staff-app/format';
import { useMySchedule } from '@/features/staff-app/hooks';
import { formatDuration } from '@/lib/format';
import { useIsOffline } from '@/lib/network';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.staffApp;

/** S1 · Staff Today: my bookings today, travel buffers between them, the next one with directions and check in. */
export default function StaffTodayScreen() {
  const { me } = useMe();
  const tz = me?.business.timezone ?? 'Asia/Kuala_Lumpur';
  const date = todayIn(tz);
  const schedule = useMySchedule(date, shiftDate(date, 1));
  const now = useNow();

  useFocusEffect(
    useCallback(() => {
      void schedule.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const bookings = schedule.data?.bookings ?? [];
  const focusId = focusBookingId(bookings, now);

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      <ScrollView
        contentContainerClassName="gap-2.5 px-4 pb-8 pt-4"
        refreshControl={<RefreshControl refreshing={schedule.isRefetching} onRefresh={() => void schedule.refetch()} />}
      >
        <View className="flex-row items-center gap-3 pb-1">
          <View className="h-11 w-11 items-center justify-center rounded-full bg-info-bg">
            <Text className="font-extrabold text-info-fg">{me ? initials(me.user.name) : ''}</Text>
          </View>
          <View className="flex-1">
            <Text className="text-[13px] font-semibold text-muted" numberOfLines={1}>
              {s.todaySub(formatInTimeZone(new Date(now), tz, 'EEE, d MMM'), me?.business.name ?? '')}
            </Text>
            <Text className="text-[20px] font-extrabold">{s.todayTitle}</Text>
          </View>
          {schedule.data ? <Tag label={s.countToday(bookings.length)} tone="neutral" /> : null}
        </View>

        {schedule.error ? (
          <ErrorState error={schedule.error} onRetry={() => void schedule.refetch()} />
        ) : !schedule.data ? (
          <LoadingState />
        ) : schedule.data.resources.length === 0 ? (
          <EmptyState title={s.noResource} body={s.noResourceBody} icon={<Icon name="user" size={32} color={colors.muted} />} />
        ) : bookings.length === 0 ? (
          <EmptyState title={s.emptyToday} body={s.emptyTodayBody} icon={<Icon name="calendar" size={32} color={colors.muted} />} />
        ) : (
          bookings.map((b, i) => (
            <Fragment key={b.id}>
              {i > 0 && b.travelBufferMin > 0 ? <TravelGap minutes={b.travelBufferMin} /> : null}
              <JobCard booking={b} tz={tz} now={now} focus={b.id === focusId} />
            </Fragment>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TravelGap({ minutes }: { minutes: number }) {
  return (
    <View className="flex-row items-center gap-2 pl-[18px]">
      <View className="h-[22px] w-0.5 bg-input-border" />
      <Text className="text-[12px] font-bold text-muted">{s.travel(formatDuration(minutes))}</Text>
    </View>
  );
}

const openJob = (id: number) => router.push({ pathname: '/staff/job/[id]', params: { id: String(id) } });

function JobCard({ booking: b, tz, now, focus }: { booking: Booking; tz: string; now: number; focus: boolean }) {
  const setStatus = useSetBookingStatus(b.id);
  const offline = useIsOffline();
  const startsIn = Date.parse(b.startAt) - now;
  const phone = b.customer.phone;
  const answer = firstAnswer(b);

  const tag =
    b.status === 'checked_in'
      ? { label: s.inProgress, tone: 'info' as const }
      : focus
        ? { label: startsIn > 0 ? s.nextIn(formatIn(startsIn)) : s.nowOn, tone: 'pending' as const }
        : { label: t.booking.status[b.status], tone: statusTone[b.status] };

  const checkIn = () =>
    setStatus.mutate(
      { status: 'checked_in' },
      {
        onSuccess: () => {
          showToast({ message: s.checkedInToast });
          openJob(b.id);
        },
      },
    );

  return (
    <Card className={`gap-2.5 p-3.5 ${focus ? 'border-2 border-primary' : ''}`}>
      {/* Only the summary is the tap target: the buttons below must not sit inside another button (web). */}
      <Pressable
        onPress={() => openJob(b.id)}
        accessibilityRole="button"
        accessibilityLabel={`${b.customer.name}, ${b.service.name}`}
        className="gap-2.5"
      >
        <View className="flex-row items-center justify-between gap-2">
          <Text className="text-[16px] font-extrabold">{formatInTimeZone(new Date(b.startAt), tz, 'h:mm a')}</Text>
          <Tag label={tag.label} tone={tag.tone} />
        </View>
        <Text className="text-[14px]">
          <Text className="font-bold">{b.customer.name}</Text>
          <Text className="text-muted"> · {b.service.name}</Text>
        </Text>
        {answer ? <Text className="text-[13px] text-muted">{answer}</Text> : null}
      </Pressable>

        {focus ? (
          <>
            {b.locationAddress ? (
              <View className="flex-row items-center gap-1.5">
                <Icon name="pin" size={16} color={colors.text} />
                <Text className="flex-1 text-[13px] font-semibold">{b.locationAddress}</Text>
              </View>
            ) : null}
            <View className="flex-row gap-2">
              {b.locationAddress ? (
                <>
                  <LinkButton label={s.waze} url={wazeUrl(b.locationAddress)} />
                  <LinkButton label={s.maps} url={mapsUrl(b.locationAddress)} />
                </>
              ) : null}
              {phone ? (
                <Pressable
                  onPress={() => void Linking.openURL(whatsappUrl(phone))}
                  accessibilityRole="link"
                  accessibilityLabel={s.whatsapp}
                  className="h-11 w-11 items-center justify-center rounded-button border border-input-border bg-card active:bg-pressed"
                >
                  <Icon name="chat" size={20} color={colors.primary} />
                </Pressable>
              ) : null}
            </View>
            <FormError message={setStatus.error ? errorMessage(setStatus.error) : null} />
            {b.status === 'checked_in' ? (
              <Button title={s.openJob} onPress={() => openJob(b.id)} />
            ) : b.status === 'confirmed' ? (
              <Button title={s.checkInArrived} loading={setStatus.isPending} disabled={offline} onPress={checkIn} />
            ) : null}
          </>
        ) : null}
    </Card>
  );
}

function LinkButton({ label, url }: { label: string; url: string }) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      accessibilityRole="link"
      className="h-11 flex-1 items-center justify-center rounded-button border border-input-border bg-card active:bg-pressed"
    >
      <Text className="text-[13px] font-bold">{label}</Text>
    </Pressable>
  );
}
