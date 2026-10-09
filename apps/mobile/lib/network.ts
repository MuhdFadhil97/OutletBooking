import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import * as Network from 'expo-network';
import { onlineManager } from '@tanstack/react-query';

/** When the app last went offline (shown in the D9 banner). */
let offlineSince: Date | null = null;

/**
 * TanStack Query follows the phone's connection: while offline, queries keep their cached data
 * and stop refetching. On web the browser's online/offline events are used (Query's default).
 */
export function setupNetwork() {
  onlineManager.subscribe((online) => {
    offlineSince = online ? null : new Date();
  });
  if (Platform.OS === 'web') return;
  onlineManager.setEventListener((setOnline) => {
    const sub = Network.addNetworkStateListener((s) => setOnline(s.isConnected !== false && s.isInternetReachable !== false));
    void Network.getNetworkStateAsync().then((s) => setOnline(s.isConnected !== false && s.isInternetReachable !== false));
    return () => sub.remove();
  });
}

export function useIsOffline(): boolean {
  return !useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
}

export const getOfflineSince = () => offlineSince;
