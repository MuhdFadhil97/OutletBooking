import { Pressable, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { t } from '@/strings/en';
import { colors } from '@/theme';
import { useNotifications } from '../hooks';

/** Header bell with the unread count (opens D6). */
export function BellButton({ onPress }: { onPress: () => void }) {
  const unread = useNotifications().data?.unread ?? 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={unread ? `${t.notifications.open}, ${t.notifications.unread(unread)}` : t.notifications.open}
      className="h-11 w-11 items-center justify-center rounded-button border border-border bg-card active:bg-pressed"
    >
      <Icon name="bell" color={colors.text} />
      {unread ? (
        <View className="absolute -right-1.5 -top-1.5 min-w-[20px] items-center rounded-full border-2 border-bg bg-danger px-1">
          <Text className="text-[11px] font-extrabold text-white">{unread > 99 ? '99+' : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
