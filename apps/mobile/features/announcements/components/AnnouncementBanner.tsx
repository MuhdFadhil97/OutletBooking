import { Pressable, View } from 'react-native';
import type { ActiveAnnouncement } from '@outletbooking/shared';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { t } from '@/strings/en';
import { colors } from '@/theme';

/** I28 · A notice from FTech at the top of Today (O2), until the owner dismisses it or FTech's end date passes. */
export function AnnouncementBanner({ item, onDismiss }: { item: ActiveAnnouncement; onDismiss: () => void }) {
  return (
    <View className="gap-1.5 rounded-card bg-info-bg px-3.5 py-3" accessibilityRole="alert">
      <View className="flex-row items-start gap-2">
        <View className="pt-0.5">
          <Icon name="bell" size={18} color={colors['info-fg']} />
        </View>
        <View className="flex-1 gap-1">
          <Text className="text-[14px] font-extrabold text-info-fg">{item.title}</Text>
          <Text className="text-[13px] text-info-fg">{item.body}</Text>
        </View>
      </View>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={t.today.announcementDismiss}
        className="min-h-[44px] items-end justify-center active:opacity-70"
      >
        <Text className="text-[14px] font-bold text-info-fg">{t.today.announcementDismiss}</Text>
      </Pressable>
    </View>
  );
}
