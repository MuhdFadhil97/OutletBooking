import { View } from 'react-native';
import { Text } from './ui/Text';
import { Icon } from './ui/Icon';

/** Logo mark + wordmark used on auth screens. */
export function Brand({ right }: { right?: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <View className="flex-row items-center gap-2.5">
        <View className="h-9 w-9 items-center justify-center rounded-[10px] bg-primary">
          <Icon name="calendar" size={20} color="#FFFFFF" />
        </View>
        <Text className="text-[18px] font-extrabold">OutletBooking</Text>
      </View>
      {right ? <Text className="text-[13px] font-semibold text-muted">{right}</Text> : null}
    </View>
  );
}
