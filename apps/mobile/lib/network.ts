import { useSyncExternalStore } from 'react';
import * as Network from 'expo-network';
import { onlineManager, type QueryClient } from '@tanstack/react-query';

/**
 * D9 · offline. TanStack Query learns the connection state from expo-network, so queries pause
 * offline and refetch when the phone is back. "Connected" (not internet-reachable) on purpose:
 * in development the API is on the local network.
 */
onlineManager.setEventListener((setOnline) => {
  void Network.getNetworkStateAsync()
    .then((s) => setOnline(s.isConnected !== false))
    .catch(() => undefined);
  const sub = Network.addNetworkStateListener((s) => setOnline(s.isConnected !== false));
  return () => sub.remove();
});

export const useIsOnline = () =>
  useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );

let lastSync: number | null = null;
const listeners = new Set<() => void>();

/** Remembers when data last arrived from the API ("showing schedule from 5:41 PM"). */
export function trackLastSync(client: QueryClient) {
  client.getQueryCache().subscribe((e) => {
    if (e.type === 'updated' && e.action.type === 'success') {
      lastSync = Date.now();
      listeners.forEach((l) => l());
    }
  });
}

export const useLastSync = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => lastSync,
    () => lastSync,
  );
