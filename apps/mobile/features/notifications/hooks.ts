import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationList } from '@outletbooking/shared';
import * as api from './api';

export const notificationKeys = { list: ['notifications'] as const };

/** D6 list + unread count (Today bell). Refreshes every minute while visible. */
export const useNotifications = () =>
  useQuery({ queryKey: notificationKeys.list, queryFn: api.listNotifications, refetchInterval: 60_000 });

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: number[]) => api.markNotificationsRead(ids),
    // Show it read straight away; the refetch confirms.
    onMutate: (ids) => {
      qc.setQueryData<NotificationList>(notificationKeys.list, (old) => {
        if (!old) return old;
        const items = old.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n));
        return { items, unreadCount: items.filter((n) => !n.read).length };
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.list }),
  });
}
