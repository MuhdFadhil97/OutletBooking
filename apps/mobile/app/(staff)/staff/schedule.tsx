import { useCallback, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import type { Booking, MySchedule } from '@outletbooking/shared';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Tag } from '@/components/ui/Tag';
import { Text } from '@/components/ui/Text';
import { shiftDate, statusTone, todayIn } from '@/features/bookings/format';
import { useMe } from '@/features/me/hooks';
import { dayOffLabel, firstAnswer } from '@/features/staff-app/format';
import { useMySchedule } from '@/features/staff-app/hooks';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.staffApp;
const DAYS = 7;

/** G2 · My schedule: 7-day strip, bookings grouped by day, days off. Arrows move a week at a time. */
export default function StaffScheduleScreen() {
  const { me } = useMe();
  const tz = me?.business.timezone ?? 'Asia/Kuala_Lumpur';
  const today = todayIn(tz);
  const [weekOffset, setWeekOffset] = useState(0);
  const from = shiftDate(today, weekOffset * DAYS);
  const days = Array.from({ length: DAYS }, (_, i) => shiftDate(from, i));
  const schedule = useMySchedule(from, shiftDate(from, DAYS));
  const [selected, setSelected] = useState(today);
  const scroll = useRef<ScrollView>(null);
  const groupY = useRef(new Map<string, number>());

  useFocusEffect(
    useCallback(() => {
      void schedule.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const moveWeek = (by: number) => {
    const next = weekOffset + by;
    setWeekOffset(next);
    setSelected(shiftDate(today, next * DAYS));
    groupY.current.clear();
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const jumpTo = (date: string) => {
    setSelected(date);
    const y = groupY.current.get(date);
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
  };

  const data = schedule.data;
  const byDay = new Map<string, Booking[]>();
  for (const b of data?.bookings ?? []) {
    const d = formatInTimeZone(new Date(b.startAt), tz, 'yyyy-MM-dd');
    byDay.set(d, [...(byDay.get(d) ?? []), b]);
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      <View className="gap-3 border-b border-border bg-card px-4 pb-3 pt-4">
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 text-[20px] font-extrabold">{s.scheduleTitle}</Text>
          <WeekArrow icon="chevron-left" label={s.prevWeek} disabled={weekOffset === 0} onPress={() => moveWeek(-1)} />
          <WeekArrow icon="chevron-right" label={s.nextWeek} onPress={() => moveWeek(1)} />
        </View>
        <View className="flex-row justify-between gap-1.5">
          {days.map((d) => (
            <DayButton
              key={d}
              date={d}
              selected={d === selected}
              off={data ? !byDay.has(d) && dayOffLabel(d, data.hours, data.timeOff, tz) !== null : false}
              onPress={() => jumpTo(d)}
            />
          ))}
        </View>
      </View>

      <ScrollView
        ref={scroll}
        contentContainerClassName="gap-2.5 px-4 pb-8 pt-3.5"
        refreshControl={<RefreshControl refreshing={schedule.isRefetching} onRefresh={() => void schedule.refetch()} />}
      >
        {schedule.error ? (
          <ErrorState error={schedule.error} onRetry={() => void schedule.refetch()} />
        ) : !data ? (
          <LoadingState />
        ) : data.resources.length === 0 ? (
          <EmptyState title={s.noResource} body={s.noResourceBody} icon={<Icon name="user" size={32} color={colors.muted} />} />
        ) : (
          days.map((d) => (
            <View key={d} className="gap-2" onLayout={(e) => groupY.current.set(d, e.nativeEvent.layout.y)}>
              <Text className="pt-1 text-[12px] font-extrabold uppercase tracking-[0.6px] text-muted">
                {format(parseISO(d), 'EEE, d MMM')}
                {d === today ? ` · ${s.today}` : ''}
              </Text>
              <DayGroup date={d} bookings={byDay.get(d) ?? []} schedule={data} tz={tz} />
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DayGroup({ date, bookings, schedule, tz }: { date: string; bookings: Booking[]; schedule: MySchedule; tz: string }) {
  if (!bookings.length) {
    const off = dayOffLabel(date, schedule.hours, schedule.timeOff, tz);
    return (
      <Card className="flex-row items-center justify-between px-3.5 py-3">
        <Text className="text-[14px] text-muted">{s.noBookings}</Text>
        {off ? <Tag label={off === 'closed' ? s.closed : s.dayOff} tone="neutral" /> : null}
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      {bookings.map((b, i) => (
        <Pressable
          key={b.id}
          onPress={() => router.push({ pathname: '/staff/job/[id]', params: { id: String(b.id) } })}
          accessibilityRole="button"
          className={`min-h-[56px] flex-row items-center gap-3 px-3.5 py-3 active:bg-pressed ${i < bookings.length - 1 ? 'border-b border-border' : ''}`}
        >
          <Text className="w-[72px] text-[14px] font-extrabold">{formatInTimeZone(new Date(b.startAt), tz, 'h:mm a')}</Text>
          <View className="flex-1">
            <Text className="text-[14px] font-bold" numberOfLines={1}>
              {b.customer.name}
            </Text>
            <Text className="text-[12px] text-muted" numberOfLines={1}>
              {[b.service.name, firstAnswer(b)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {b.status !== 'confirmed' ? <Tag label={t.booking.status[b.status]} tone={statusTone[b.status]} /> : null}
        </Pressable>
      ))}
    </Card>
  );
}

function DayButton({ date, selected, off, onPress }: { date: string; selected: boolean; off: boolean; onPress: () => void }) {
  const d = parseISO(date);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={format(d, 'EEEE d MMMM')}
      className={`h-[56px] flex-1 items-center justify-center rounded-button border ${
        selected ? 'border-primary bg-primary' : 'border-border bg-card active:bg-pressed'
      }`}
    >
      <Text className={`text-[11px] font-bold ${selected ? 'text-white' : off ? 'text-muted' : ''}`}>{format(d, 'EEE')}</Text>
      <Text className={`text-[16px] font-extrabold ${selected ? 'text-white' : off ? 'text-muted line-through' : ''}`}>
        {format(d, 'd')}
      </Text>
    </Pressable>
  );
}

function WeekArrow({ icon, label, disabled, onPress }: { icon: 'chevron-left' | 'chevron-right'; label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`h-11 w-11 items-center justify-center rounded-button border border-border bg-card active:bg-pressed ${disabled ? 'opacity-40' : ''}`}
    >
      <Icon name={icon} size={20} color={colors.text} />
    </Pressable>
  );
}
