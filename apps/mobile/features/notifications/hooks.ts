import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationList } from '@outletbooking/shared';
import { getNotifications, markAllNotificationsRead, markNotificationRead } from './api';

export const notificationsKey = ['notifications'] as const;

/** D6 list + unread count. Polls while the app is open; push (when available) refreshes it sooner. */
export function useNotifications() {
  return useQuery({ queryKey: notificationsKey, queryFn: getNotifications, refetchInterval: 60_000 });
}

function useSetRead() {
  const qc = useQueryClient();
  return (match: (id: number) => boolean) =>
    qc.setQueryData<NotificationList>(notificationsKey, (old) => {
      if (!old) return old;
      const items = old.items.map((n) => (match(n.id) ? { ...n, read: true } : n));
      return { items, unread: old.unread - old.items.filter((n) => match(n.id) && !n.read).length };
    });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  const setRead = useSetRead();
  return useMutation({
    mutationFn: markNotificationRead,
    onMutate: (id) => setRead((n) => n === id),
    onSettled: () => qc.invalidateQueries({ queryKey: notificationsKey }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  const setRead = useSetRead();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onMutate: () => setRead(() => true),
    onSettled: () => qc.invalidateQueries({ queryKey: notificationsKey }),
  });
}
