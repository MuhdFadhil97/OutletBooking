import { useEffect } from 'react';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { MemberRole } from '@outletbooking/shared';
import { pushSupported, registerForPush } from './register';

type BookingPushData = { type?: string; bookingId?: number };

/**
 * Mounted inside the owner / staff tab layouts: registers this device for booking notifications,
 * shows them while the app is open, refreshes bookings, and opens the booking when one is tapped.
 */
export function PushSetup({ role }: { role: MemberRole }) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!pushSupported) return;
    let cancelled = false;
    const subs: { remove: () => void }[] = [];

    const open = (data: BookingPushData) => {
      if (role === 'owner' && typeof data.bookingId === 'number') {
        router.push({ pathname: '/calendar/[id]', params: { id: String(data.bookingId) } });
      } else if (role === 'staff') {
        router.push('/staff/today');
      }
    };

    void (async () => {
      const Notifications = await import('expo-notifications');
      if (cancelled) return;
      Notifications.setNotificationHandler({
        handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
      });
      subs.push(
        Notifications.addNotificationReceivedListener(() => void qc.invalidateQueries({ queryKey: ['bookings'] })),
        Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data as BookingPushData)),
      );
      // App opened by tapping a notification while it was closed.
      const last = await Notifications.getLastNotificationResponseAsync();
      if (last && !cancelled) open(last.notification.request.content.data as BookingPushData);

      await registerForPush().catch((err: unknown) => console.warn('Push registration failed', err));
    })();

    return () => {
      cancelled = true;
      subs.forEach((s) => s.remove());
    };
  }, [role, qc]);

  return null;
}
