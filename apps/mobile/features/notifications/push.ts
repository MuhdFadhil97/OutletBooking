import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { deletePushToken, savePushToken } from './api';

type NotificationsModule = typeof import('expo-notifications');

/** EAS project id (from `eas init`) — Expo push tokens need it. */
const projectId: string | undefined =
  (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ?? Constants.easConfig?.projectId;

/**
 * Remote push works on a real iOS / Android device with an EAS project id — but not in
 * Expo Go on Android (removed in SDK 53; use a development build) and not on web.
 */
export const pushSupported =
  Platform.OS !== 'web' &&
  Device.isDevice &&
  !!projectId &&
  !(Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient);

let mod: Promise<NotificationsModule> | null = null;
/** Loaded only where push is supported, so web and Expo Go on Android never touch it. */
export function notificationsModule(): Promise<NotificationsModule> | null {
  if (!pushSupported) return null;
  mod ??= import('expo-notifications').then((N) => {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    return N;
  });
  return mod;
}

let registeredToken: string | null = null;

/** Asks for permission (once) and saves this device's token for the logged-in user. Never throws. */
export async function registerForPush(): Promise<void> {
  const loading = notificationsModule();
  if (!loading) return;
  try {
    const N = await loading;
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync('default', { name: 'Bookings', importance: N.AndroidImportance.HIGH });
    }
    let { status } = await N.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await N.requestPermissionsAsync());
    if (status !== 'granted') return;
    const { data: token } = await N.getExpoPushTokenAsync({ projectId });
    await savePushToken({ token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    registeredToken = token;
  } catch (err) {
    console.warn('Push registration skipped:', err instanceof Error ? err.message : err);
  }
}

/** Before log out: this device stops getting the user's push. Never throws. */
export async function unregisterPush(): Promise<void> {
  const token = registeredToken;
  if (!token) return;
  registeredToken = null;
  try {
    await deletePushToken(token);
  } catch {
    // Offline: the token moves to whoever logs in next on this device anyway.
  }
}
