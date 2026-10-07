import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { deletePushToken, savePushToken } from './api';

/** Token registered for the signed-in user on this device (removed on logout). */
let registered: string | null = null;

/** Remote push is not available in Expo Go on Android (SDK 53+) — it needs a development build. */
const expoGoAndroid = Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const pushSupported = Platform.OS !== 'web' && Device.isDevice && !expoGoAndroid;

/** Android channel used by booking notifications (`channelId: 'bookings'` from the API). */
export const BOOKINGS_CHANNEL = 'bookings';

/**
 * FR-10.1: asks permission, gets this device's Expo push token and stores it for the signed-in user.
 * Quietly does nothing where push can't work (web, simulator, Expo Go on Android, no EAS project id).
 */
export async function registerForPush(): Promise<void> {
  if (!pushSupported) return;
  const projectId =
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    if (__DEV__) console.info('Push notifications off: no EAS projectId. Run `eas init` in apps/mobile to link the project.');
    return;
  }
  // Loaded lazily so Expo Go on Android never touches the removed remote-push module.
  const Notifications = await import('expo-notifications');
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(BOOKINGS_CHANNEL, {
      name: 'Bookings',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return;

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await savePushToken({ token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
  registered = token;
}

/** Before logout: stop notifications for this device. Never blocks logging out. */
export async function unregisterPush(): Promise<void> {
  if (!registered) return;
  const token = registered;
  registered = null;
  try {
    await deletePushToken(token);
  } catch {
    // Offline or session already gone — the API drops dead tokens when Expo reports them.
  }
}
