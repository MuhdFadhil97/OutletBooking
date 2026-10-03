import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { addDays, addMonths, endOfMonth, format, getDay, parseISO, startOfMonth } from 'date-fns';
import { WEEKDAY_SHORT } from '@outletbooking/shared';
import { colors } from '@/theme';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { Text } from './Text';

/** Button showing a calendar date ("yyyy-MM-dd"); opens a month grid. */
export function DateSelect({
  label,
  value,
  onChange,
  min,
}: {
  label: string;
  value: string;
  onChange: (date: string) => void;
  /** Earliest selectable date, "yyyy-MM-dd". */
  min?: string;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(value ? parseISO(value) : new Date()));

  const first = startOfMonth(month);
  const days: (Date | null)[] = [
    ...Array<null>(getDay(first)).fill(null),
    ...Array.from({ length: endOfMonth(month).getDate() }, (_, i) => addDays(first, i)),
  ];

  return (
    <>
      <Pressable
        onPress={() => {
          setMonth(startOfMonth(value ? parseISO(value) : new Date()));
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || 'not set'}`}
        className="h-[44px] flex-1 flex-row items-center justify-between rounded-input border border-input-border bg-card px-3 active:bg-pressed"
      >
        <Text className="text-[15px] font-semibold">{value ? format(parseISO(value), 'EEE, d MMM yyyy') : '—'}</Text>
        <Icon name="calendar" size={18} color={colors.muted} />
      </Pressable>
      <Sheet visible={open} title={label} onClose={() => setOpen(false)}>
        <View className="flex-row items-center justify-between">
          <Pressable
            onPress={() => setMonth((m) => addMonths(m, -1))}
            accessibilityLabel="Previous month"
            className="h-11 w-11 items-center justify-center"
          >
            <Icon name="chevron-left" color={colors.text} />
          </Pressable>
          <Text className="text-[16px] font-bold">{format(month, 'MMMM yyyy')}</Text>
          <Pressable
            onPress={() => setMonth((m) => addMonths(m, 1))}
            accessibilityLabel="Next month"
            className="h-11 w-11 items-center justify-center"
          >
            <Icon name="chevron-right" color={colors.text} />
          </Pressable>
        </View>
        <View className="flex-row">
          {WEEKDAY_SHORT.map((d) => (
            <Text key={d} className="flex-1 text-center text-[12px] font-bold text-muted">
              {d}
            </Text>
          ))}
        </View>
        <View className="flex-row flex-wrap">
          {days.map((d, i) => {
            if (!d) return <View key={`e${i}`} className="h-11 basis-[14.28%]" />;
            const key = format(d, 'yyyy-MM-dd');
            const on = key === value;
            const disabled = !!min && key < min;
            return (
              <Pressable
                key={key}
                disabled={disabled}
                onPress={() => {
                  onChange(key);
                  setOpen(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on, disabled }}
                accessibilityLabel={format(d, 'EEEE d MMMM yyyy')}
                className="h-11 basis-[14.28%] items-center justify-center"
              >
                <View className={`h-10 w-10 items-center justify-center rounded-full ${on ? 'bg-primary' : ''}`}>
                  <Text className={`text-[15px] ${on ? 'font-bold text-white' : disabled ? 'text-[#B8C1BC]' : ''}`}>
                    {d.getDate()}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </>
  );
}
