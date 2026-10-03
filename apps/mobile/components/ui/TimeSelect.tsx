import { useMemo, useState } from 'react';
import { FlatList, Pressable } from 'react-native';
import { formatTime, timeOptions } from '@/lib/format';
import { Sheet } from './Sheet';
import { Text } from './Text';

const ROW = 48;

/** Button showing a local time; opens a list of times (every `step` minutes). */
export function TimeSelect({
  label,
  value,
  onChange,
  step = 30,
  allowMidnightEnd,
  min,
}: {
  label: string;
  value: string;
  onChange: (hhmm: string) => void;
  step?: number;
  /** Offer "12:00 AM (midnight)" = "24:00" at the end of the list (for end times). */
  allowMidnightEnd?: boolean;
  /** Hide options at or before this time (e.g. end must be after start). */
  min?: string;
}) {
  const [open, setOpen] = useState(false);
  const options = useMemo(() => {
    const all = timeOptions(step, allowMidnightEnd);
    if (value && !all.includes(value)) all.push(value);
    all.sort();
    return min ? all.filter((t) => t > min) : all;
  }, [step, allowMidnightEnd, min, value]);
  const index = Math.max(0, options.indexOf(value));

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? formatTime(value) : 'not set'}`}
        className="h-[44px] min-w-[104px] items-center justify-center rounded-input border border-input-border bg-card px-3 active:bg-pressed"
      >
        <Text className="text-[15px] font-semibold">{value ? formatTime(value) : '—'}</Text>
      </Pressable>
      <Sheet visible={open} title={label} onClose={() => setOpen(false)} scroll={false}>
        <FlatList
          data={options}
          keyExtractor={(t) => t}
          initialScrollIndex={index}
          getItemLayout={(_, i) => ({ length: ROW, offset: ROW * i, index: i })}
          style={{ maxHeight: ROW * 8 }}
          renderItem={({ item }) => {
            const on = item === value;
            return (
              <Pressable
                onPress={() => {
                  onChange(item);
                  setOpen(false);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={{ height: ROW }}
                className={`justify-center rounded-input px-3 ${on ? 'bg-primary-tint' : 'active:bg-pressed'}`}
              >
                <Text className={`text-[16px] ${on ? 'font-bold text-ok-fg' : ''}`}>
                  {formatTime(item)}
                  {item === '24:00' ? ' (midnight)' : ''}
                </Text>
              </Pressable>
            );
          }}
        />
      </Sheet>
    </>
  );
}
