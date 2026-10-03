import { Pressable, ScrollView, View } from 'react-native';
import { format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import type { Booking } from '@outletbooking/shared';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Tag } from '@/components/ui/Tag';
import { Text } from '@/components/ui/Text';
import { t } from '@/strings/en';
import { colors } from '@/theme';
import { eventStyle, formatTimeSpan, shiftDate, statusTone } from '../format';

/** Week list: one card per day (Mon–Sun) with that day's bookings in time order. */
export function WeekView({
  monday,
  tz,
  today,
  bookings,
  onPressDay,
  onPressBooking,
}: {
  monday: string;
  tz: string;
  today: string;
  bookings: Booking[];
  onPressDay: (date: string) => void;
  onPressBooking: (b: Booking) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(monday, i));
  const byDay = new Map<string, Booking[]>(days.map((d) => [d, []]));
  for (const b of bookings) byDay.get(formatInTimeZone(new Date(b.startAt), tz, 'yyyy-MM-dd'))?.push(b);

  return (
    <ScrollView contentContainerClassName="gap-3 px-4 pb-24 pt-3">
      {days.map((d) => {
        const list = byDay.get(d)!;
        return (
          <Card key={d} className="overflow-hidden">
            <Pressable
              onPress={() => onPressDay(d)}
              accessibilityRole="button"
              className="min-h-[48px] flex-row items-center gap-2 px-3.5 py-2 active:bg-pressed"
            >
              <Text className={`flex-1 text-[15px] font-extrabold ${d === today ? 'text-primary' : ''}`}>
                {format(parseISO(d), 'EEE, d MMM')}
                {d === today ? ` · ${t.calendar.today}` : ''}
              </Text>
              <Text className="text-[13px] font-semibold text-muted">{list.length || ''}</Text>
              <Icon name="chevron-right" size={18} color={colors.muted} />
            </Pressable>
            {list.map((b) => {
              const s = eventStyle(b);
              return (
                <Pressable
                  key={b.id}
                  onPress={() => onPressBooking(b)}
                  accessibilityRole="button"
                  className="flex-row items-center gap-3 border-t border-border px-3.5 py-2.5 active:bg-pressed"
                >
                  <View className="h-9 w-1 rounded-full" style={{ backgroundColor: s.border }} />
                  <View className="flex-1 gap-0.5">
                    <Text className="text-[14px] font-bold" numberOfLines={1}>
                      {b.customer.name}
                    </Text>
                    <Text className="text-[12px] text-muted" numberOfLines={1}>
                      {formatTimeSpan(b.startAt, b.endAt, tz)} · {b.resource.name} · {b.service.name}
                    </Text>
                  </View>
                  {b.status !== 'confirmed' ? <Tag label={t.booking.status[b.status]} tone={statusTone[b.status]} /> : null}
                </Pressable>
              );
            })}
          </Card>
        );
      })}
    </ScrollView>
  );
}
