import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { formatInTimeZone } from 'date-fns-tz';
import type { Booking, WorkingHour } from '@outletbooking/shared';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { DayView } from '@/features/bookings/components/DayView';
import { WeekView } from '@/features/bookings/components/WeekView';
import { formatDayTitle, formatWeekTitle, shiftDate, todayIn, weekStart } from '@/features/bookings/format';
import { useBookingsRange, useResourcesHours } from '@/features/bookings/hooks';
import { useBusiness, useResources } from '@/features/setup/hooks';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const c = t.calendar;
type Mode = 'day' | 'week';

/** O3 · Calendar: day view by resource, week list. FAB opens a new booking. */
export default function CalendarScreen() {
  const business = useBusiness();
  const resources = useResources();
  const tz = business.data?.timezone ?? 'Asia/Kuala_Lumpur';
  const [mode, setMode] = useState<Mode>('day');
  const [date, setDate] = useState(() => todayIn(tz));
  const today = todayIn(tz);

  // Business timezone arrives after the first render.
  useEffect(() => {
    if (business.data) setDate(todayIn(business.data.timezone));
  }, [business.data?.timezone]); // eslint-disable-line react-hooks/exhaustive-deps

  const monday = weekStart(date);
  const [from, to] = mode === 'day' ? [date, shiftDate(date, 1)] : [monday, shiftDate(monday, 7)];
  const bookings = useBookingsRange(from, to);

  const active = useMemo(
    () => (resources.data ?? []).filter((r) => r.isActive).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    [resources.data],
  );
  const hoursQueries = useResourcesHours(mode === 'day' ? active.map((r) => r.id) : []);
  const hours = new Map<number, WorkingHour[]>(active.map((r, i) => [r.id, hoursQueries[i]?.data ?? []]));

  // Come back from detail / new booking → show fresh data.
  useFocusEffect(
    useCallback(() => {
      void bookings.refetch();
    }, [bookings.refetch]), // eslint-disable-line react-hooks/exhaustive-deps
  );

  const openBooking = (b: Booking) => router.push({ pathname: '/calendar/[id]', params: { id: String(b.id) } });
  const newBooking = (params: Record<string, string> = {}) =>
    router.push({ pathname: '/calendar/new', params: { date, ...params } });

  const step = mode === 'day' ? 1 : 7;
  const label = business.data?.resourceLabel ?? 'Resource';
  const count = bookings.data?.length ?? 0;

  let body;
  if (!business.data || !resources.data) {
    const error = business.error ?? resources.error;
    body = error ? <ErrorState error={error} onRetry={() => void resources.refetch()} /> : <LoadingState />;
  } else if (active.length === 0) {
    body = (
      <EmptyState
        icon={<Icon name="calendar" size={28} color={colors.muted} />}
        title={c.noResources}
        body={c.noResourcesBody}
        action={<Button title={t.tabs.setup} variant="secondary" onPress={() => router.push('/setup')} />}
      />
    );
  } else if (bookings.error) {
    body = <ErrorState error={bookings.error} onRetry={() => void bookings.refetch()} />;
  } else if (!bookings.data) {
    body = <LoadingState />;
  } else if (mode === 'day') {
    const nowMin =
      date === today ? Number(formatInTimeZone(new Date(), tz, 'H')) * 60 + Number(formatInTimeZone(new Date(), tz, 'm')) : null;
    body = (
      <DayView
        date={date}
        tz={tz}
        resources={active}
        hours={hours}
        bookings={bookings.data}
        nowMin={nowMin}
        onPressBooking={openBooking}
        onPressEmpty={(resourceId, minute) =>
          newBooking({
            resourceId: String(resourceId),
            time: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`,
          })
        }
      />
    );
  } else {
    body = (
      <WeekView
        monday={monday}
        tz={tz}
        today={today}
        bookings={bookings.data}
        onPressDay={(d) => {
          setDate(d);
          setMode('day');
        }}
        onPressBooking={openBooking}
      />
    );
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      <View className="gap-3 border-b border-border bg-card px-4 pb-3 pt-3.5">
        <View className="flex-row items-center justify-between">
          <Text className="text-[20px] font-extrabold">{c.title}</Text>
          <View className="flex-row rounded-input bg-neutral-bg p-[3px]">
            {(['day', 'week'] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === m }}
                className={`h-9 justify-center rounded-lg px-4 ${mode === m ? 'bg-card' : ''}`}
              >
                <Text className={`text-[13px] font-bold ${mode === m ? 'text-text' : 'text-neutral-fg'}`}>{c[m]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View className="flex-row items-center justify-between">
          <NavButton icon="chevron-left" label={mode === 'day' ? c.prevDay : c.prevWeek} onPress={() => setDate(shiftDate(date, -step))} />
          <Pressable onPress={() => setDate(today)} accessibilityRole="button" accessibilityHint={c.today} className="items-center px-2">
            <Text className="text-[15px] font-extrabold">
              {mode === 'day' ? formatDayTitle(date) : formatWeekTitle(monday)}
              {mode === 'day' && date === today ? ` · ${c.today}` : ''}
            </Text>
            <Text className="text-[12px] text-muted">
              {mode === 'day' ? c.summary(count, active.length, label) : c.weekSummary(count)}
            </Text>
          </Pressable>
          <NavButton icon="chevron-right" label={mode === 'day' ? c.nextDay : c.nextWeek} onPress={() => setDate(shiftDate(date, step))} />
        </View>
      </View>

      <View className="flex-1 pl-1 pr-2">{body}</View>

      {active.length > 0 ? (
        <Pressable
          onPress={() => newBooking()}
          accessibilityRole="button"
          accessibilityLabel={c.newBooking}
          className="absolute bottom-4 right-4 h-14 w-14 items-center justify-center rounded-full bg-primary active:bg-primary-pressed"
          style={{ shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 6 }, elevation: 6 }}
        >
          <Icon name="plus" size={26} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

function NavButton({ icon, label, onPress }: { icon: 'chevron-left' | 'chevron-right'; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-11 w-11 items-center justify-center rounded-input border border-border bg-card active:bg-pressed"
    >
      <Icon name={icon} color={colors.text} />
    </Pressable>
  );
}
