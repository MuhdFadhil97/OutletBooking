import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { formatInTimeZone } from 'date-fns-tz';
import { getOfflineSince, useIsOffline } from '@/lib/network';
import { t } from '@/strings/en';
import { Icon } from './ui/Icon';
import { Text } from './ui/Text';

const TZ = 'Asia/Kuala_Lumpur';

/** D9: shown on every screen while offline. Cached data stays visible; saving fails until back online. */
export function OfflineBanner() {
  const offline = useIsOffline();
  const insets = useSafeAreaInsets();
  if (!offline) return null;
  const since = getOfflineSince();

  const retry = () =>
    void Network.getNetworkStateAsync()
      .then((s) => onlineManager.setOnline(s.isConnected !== false && s.isInternetReachable !== false))
      .catch(() => undefined);

  return (
    <View pointerEvents="box-none" className="absolute left-0 right-0" style={{ top: insets.top }}>
      <View className="mx-3 mt-1 gap-1 rounded-button bg-pend-bg px-3.5 py-2.5" accessibilityRole="alert">
        <View className="flex-row items-center gap-2">
          <Icon name="wifi-off" size={18} color="#8A4A06" />
          <Text className="flex-1 text-[13px] font-bold text-pend-fg">
            {t.offline.banner(since ? formatInTimeZone(since, TZ, 'h:mm a') : null)}
          </Text>
          <Pressable onPress={retry} accessibilityRole="button" hitSlop={10} className="min-h-[32px] justify-center">
            <Text className="text-[13px] font-extrabold text-pend-fg">{t.offline.retry}</Text>
          </Pressable>
        </View>
        <Text className="text-[12px] text-pend-fg">{t.offline.readOnly}</Text>
      </View>
    </View>
  );
}
