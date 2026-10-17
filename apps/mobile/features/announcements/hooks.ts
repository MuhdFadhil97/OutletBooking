import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActiveAnnouncement } from '@outletbooking/shared';
import * as api from './api';

export const announcementKeys = { active: ['announcements', 'active'] as const };

/** Banner notices for Today. A failure just means no banner: it must never get in the way of the dashboard. */
export const useActiveAnnouncements = (enabled: boolean) =>
  useQuery({ queryKey: announcementKeys.active, queryFn: api.listActiveAnnouncements, enabled, refetchInterval: 5 * 60_000, retry: false });

export function useDismissAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.dismissAnnouncement(id),
    // Gone straight away; the refetch confirms.
    onMutate: (id) => {
      qc.setQueryData<ActiveAnnouncement[]>(announcementKeys.active, (old) => old?.filter((a) => a.id !== id));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: announcementKeys.active }),
  });
}
