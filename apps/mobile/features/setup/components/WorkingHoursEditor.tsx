import { Pressable, Switch, View } from 'react-native';
import { WEEKDAY_SHORT, type WorkingHourInput } from '@outletbooking/shared';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { TimeSelect } from '@/components/ui/TimeSelect';
import { t } from '@/strings/en';
import { colors } from '@/theme';
import { WEEK_ORDER } from '../format';

const r = t.setup.resources;

/** "+ Add hours" proposes a range one hour after the day's last end (if it fits). */
function nextRange(day: WorkingHourInput[]): { startTime: string; endTime: string } | null {
  const lastEnd = day.reduce((max, h) => (h.endTime > max ? h.endTime : max), '00:00');
  const [h = 0, m = 0] = lastEnd.split(':').map(Number);
  const start = h * 60 + m + 60;
  const end = Math.min(start + 4 * 60, 24 * 60);
  if (start >= end) return null;
  const fmt = (x: number) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  return { startTime: fmt(start), endTime: fmt(end) };
}

/**
 * Weekly hours (wireframe .wh rows): a switch per day, one or more ranges per day
 * (gaps between ranges are breaks). Controlled: `value` is the full week.
 */
export function WorkingHoursEditor({
  value,
  onChange,
}: {
  value: WorkingHourInput[];
  onChange: (hours: WorkingHourInput[]) => void;
}) {
  const forDay = (d: number) =>
    value.filter((h) => h.weekday === d).sort((a, b) => a.startTime.localeCompare(b.startTime));

  const replaceDay = (d: number, ranges: WorkingHourInput[]) =>
    onChange([...value.filter((h) => h.weekday !== d), ...ranges]);

  const toggleDay = (d: number, on: boolean) => {
    if (!on) return replaceDay(d, []);
    // Turn on with the hours of the nearest open day, else 9–6.
    const template = WEEK_ORDER.map(forDay).find((x) => x.length) ?? [{ weekday: d, startTime: '09:00', endTime: '18:00' }];
    replaceDay(
      d,
      template.map((h) => ({ ...h, weekday: d })),
    );
  };

  return (
    <View>
      {WEEK_ORDER.map((d) => {
        const ranges = forDay(d);
        const open = ranges.length > 0;
        const next = nextRange(ranges);
        return (
          <View key={d} className="gap-2 border-b border-border py-2.5">
            <View className="min-h-[44px] flex-row items-center gap-2.5">
              <Text className="w-10 text-[14px] font-extrabold">{WEEKDAY_SHORT[d]}</Text>
              <Text className="flex-1 text-[14px] text-muted">{open ? '' : r.closed}</Text>
              <Switch
                value={open}
                onValueChange={(on) => toggleDay(d, on)}
                accessibilityLabel={`${WEEKDAY_SHORT[d]} open`}
                trackColor={{ true: colors.primary, false: '#B8C1BC' }}
                thumbColor="#FFFFFF"
              />
            </View>
            {ranges.map((h, i) => (
              <View key={`${h.startTime}-${i}`} className="flex-row items-center gap-2 pl-12">
                <TimeSelect
                  label={`${WEEKDAY_SHORT[d]} start`}
                  value={h.startTime}
                  onChange={(v) => replaceDay(d, ranges.map((x, j) => (j === i ? { ...x, startTime: v } : x)))}
                />
                <Text className="text-muted">–</Text>
                <TimeSelect
                  label={`${WEEKDAY_SHORT[d]} end`}
                  value={h.endTime}
                  allowMidnightEnd
                  min={h.startTime}
                  onChange={(v) => replaceDay(d, ranges.map((x, j) => (j === i ? { ...x, endTime: v } : x)))}
                />
                <Pressable
                  onPress={() => replaceDay(d, ranges.filter((_, j) => j !== i))}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${WEEKDAY_SHORT[d]} range`}
                  className="h-11 w-9 items-center justify-center"
                >
                  <Icon name="x" size={18} color={colors.muted} />
                </Pressable>
              </View>
            ))}
            {open && next ? (
              <Pressable
                onPress={() => replaceDay(d, [...ranges, { weekday: d, ...next }])}
                accessibilityRole="button"
                className="min-h-[36px] justify-center pl-12"
              >
                <Text className="text-[13px] font-bold text-primary">{r.addBreak}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
