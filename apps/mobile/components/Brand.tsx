import { View } from 'react-native';
import { Text } from './ui/Text';
import { Icon } from './ui/Icon';

/** Logo mark + wordmark used on auth screens; `step` adds "Step n of N" and the progress bar (wireframe O1). */
export function Brand({ right, step }: { right?: string; step?: { current: number; total: number; label: string } }) {
  return (
    <View className="gap-2.5">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2.5">
          <View className="h-9 w-9 items-center justify-center rounded-[10px] bg-primary">
            <Icon name="calendar" size={20} color="#FFFFFF" />
          </View>
          <Text className="text-[18px] font-extrabold">OutletBooking</Text>
        </View>
        {(step?.label ?? right) ? <Text className="text-[13px] font-semibold text-muted">{step?.label ?? right}</Text> : null}
      </View>
      {step ? (
        <View className="flex-row gap-1.5" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: step.total, now: step.current }}>
          {Array.from({ length: step.total }, (_, i) => (
            <View key={i} className={`h-1 flex-1 rounded-sm ${i < step.current ? 'bg-primary' : 'bg-border'}`} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
