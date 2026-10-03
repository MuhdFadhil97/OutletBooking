import { useState } from 'react';
import { Pressable, ScrollView, View, type GestureResponderEvent } from 'react-native';
import { parseISO } from 'date-fns';
import type { Booking, Resource, WorkingHour } from '@outletbooking/shared';
import { Text } from '@/components/ui/Text';
import { eventStyle, formatTimeSpan, minutesInDay, paymentNote } from '../format';

const HOUR_H = 64;
const PPM = HOUR_H / 60;
const GUTTER = 44;
const MIN_COL = 88;
const NOW_COLOR = '#C2410C';

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h % 24 < 12 ? 'AM' : 'PM'}`;

/**
 * O3 · One column per resource, hours down the side. Grey = outside working hours.
 * Tap a block to open it; tap empty space to start a booking there.
 */
export function DayView({
  date,
  tz,
  resources,
  hours,
  bookings,
  nowMin,
  onPressBooking,
  onPressEmpty,
}: {
  date: string;
  tz: string;
  resources: Resource[];
  /** Working hours per resource id (may still be loading → empty). */
  hours: Map<number, WorkingHour[]>;
  bookings: Booking[];
  /** Minutes since midnight when `date` is today, else null. */
  nowMin: number | null;
  onPressBooking: (b: Booking) => void;
  onPressEmpty: (resourceId: number, minute: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const weekday = parseISO(date).getDay();

  const windows = new Map(
    resources.map((r) => [
      r.id,
      (hours.get(r.id) ?? []).filter((h) => h.weekday === weekday).map((h) => ({ from: toMin(h.startTime), to: toMin(h.endTime) })),
    ]),
  );
  const placed = bookings.map((b) => ({
    b,
    from: Math.max(0, minutesInDay(b.startAt, date, tz)),
    to: Math.min(1440, minutesInDay(b.endAt, date, tz)),
  }));

  // Visible range: working hours and bookings, whole hours; 8 AM–8 PM when there is nothing.
  const edges = [...[...windows.values()].flat().flatMap((w) => [w.from, w.to]), ...placed.flatMap((p) => [p.from, p.to])];
  const startH = edges.length ? Math.floor(Math.min(...edges) / 60) : 8;
  const endH = edges.length ? Math.max(startH + 1, Math.ceil(Math.max(...edges) / 60)) : 20;
  const rangeStart = startH * 60;
  const gridH = (endH - startH) * HOUR_H;
  const y = (min: number) => (min - rangeStart) * PPM;

  const colW = width ? Math.max(MIN_COL, (width - GUTTER) / Math.max(1, resources.length)) : MIN_COL;
  const contentW = GUTTER + colW * resources.length;

  const onEmpty = (resourceId: number) => (e: GestureResponderEvent) => {
    const minute = rangeStart + Math.floor(e.nativeEvent.locationY / PPM / 30) * 30;
    onPressEmpty(resourceId, minute);
  };

  return (
    <View className="flex-1" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <ScrollView horizontal scrollEnabled={contentW > width + 1} showsHorizontalScrollIndicator={false}>
        <View style={{ width: Math.max(contentW, width) }} className="flex-1">
          <View className="flex-row border-b border-border pb-1.5 pt-2">
            <View style={{ width: GUTTER }} />
            {resources.map((r) => (
              <Text key={r.id} style={{ width: colW }} className="px-1 text-center text-[12px] font-extrabold" numberOfLines={1}>
                {r.name}
              </Text>
            ))}
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 96 }}>
            <View className="flex-row" style={{ height: gridH + 8 }}>
              <View style={{ width: GUTTER }}>
                {Array.from({ length: endH - startH }, (_, i) => (
                  <Text key={i} style={{ height: HOUR_H }} className="pl-1 pt-0.5 text-[11px] font-bold text-muted">
                    {hourLabel(startH + i)}
                  </Text>
                ))}
              </View>

              {resources.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={onEmpty(r.id)}
                  accessibilityLabel={`${r.name}: add booking`}
                  style={{ width: colW, height: gridH }}
                  className="relative border-l border-border bg-pressed"
                >
                  {(windows.get(r.id) ?? []).map((w, i) => (
                    <View
                      key={i}
                      pointerEvents="none"
                      className="absolute left-0 right-0 bg-card"
                      style={{ top: y(w.from), height: (w.to - w.from) * PPM }}
                    />
                  ))}
                  {Array.from({ length: endH - startH }, (_, i) => (
                    <View key={i} pointerEvents="none" className="absolute left-0 right-0 border-t border-border" style={{ top: i * HOUR_H }} />
                  ))}
                  {placed
                    .filter((p) => p.b.resource.id === r.id)
                    .map(({ b, from, to }) => {
                      const s = eventStyle(b);
                      const note = paymentNote(b);
                      const h = Math.max(30, (to - from) * PPM - 4);
                      return (
                        <Pressable
                          key={b.id}
                          onPress={() => onPressBooking(b)}
                          accessibilityRole="button"
                          accessibilityLabel={`${b.customer.name}, ${formatTimeSpan(b.startAt, b.endAt, tz)}`}
                          className="absolute left-[3px] right-[3px] overflow-hidden rounded-lg border px-1.5 py-1"
                          style={{ top: y(from) + 2, height: h, backgroundColor: s.bg, borderColor: s.border }}
                        >
                          <Text className="text-[12px] font-bold" style={{ color: s.fg }} numberOfLines={1}>
                            {b.customer.name}
                          </Text>
                          {h > 36 ? (
                            <Text className="text-[11px]" style={{ color: s.fg }} numberOfLines={2}>
                              {formatTimeSpan(b.startAt, b.endAt, tz)}
                              {note ? ` · ${note}` : ''}
                            </Text>
                          ) : null}
                        </Pressable>
                      );
                    })}
                </Pressable>
              ))}

              {nowMin !== null && nowMin >= rangeStart && nowMin <= endH * 60 ? (
                <View
                  pointerEvents="none"
                  className="absolute h-[2px]"
                  style={{ left: GUTTER, width: colW * resources.length, top: y(nowMin), backgroundColor: NOW_COLOR }}
                />
              ) : null}
            </View>
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}
