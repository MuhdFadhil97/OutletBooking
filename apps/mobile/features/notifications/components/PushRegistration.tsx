import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { notificationsKey } from '../hooks';
import { notificationsModule, registerForPush } from '../push';

export interface PushData {
  type?: string;
  bookingId?: number;
}

/**
 * Mounted inside the logged-in layouts: registers this device for push, refreshes the
 * D6 list when a push arrives, and opens what a tapped push is about.
 */
export function PushRegistration({ onOpen }: { onOpen: (data: PushData) => void }) {
  const qc = useQueryClient();

  useEffect(() => {
    const loading = notificationsModule();
    if (!loading) return;
    void registerForPush();
    let alive = true;
    const subs: { remove(): void }[] = [];
    void loading.then(async (N) => {
      if (!alive) return;
      subs.push(
        N.addNotificationReceivedListener(() => void qc.invalidateQueries({ queryKey: notificationsKey })),
        N.addNotificationResponseReceivedListener((r) => onOpen(r.notification.request.content.data as PushData)),
      );
      // Opened from a push while the app was closed.
      const last = await N.getLastNotificationResponseAsync();
      if (alive && last) {
        onOpen(last.notification.request.content.data as PushData);
        await N.clearLastNotificationResponseAsync();
      }
    });
    return () => {
      alive = false;
      subs.forEach((s) => s.remove());
    };
  }, [qc, onOpen]);

  return null;
}
