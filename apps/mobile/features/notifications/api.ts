import type { NotificationList } from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

export const listNotifications = () => apiFetch<NotificationList>('/notifications?limit=50');

/** Omit `ids` to mark everything read. */
export const markNotificationsRead = (ids?: number[]) =>
  apiFetch<void>('/notifications/read', { method: 'POST', json: ids ? { ids } : {} });
