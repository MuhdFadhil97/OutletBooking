import type { NotificationList, PushTokenInput } from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

export const getNotifications = () => apiFetch<NotificationList>('/notifications');
export const markNotificationRead = (id: number) => apiFetch<void>(`/notifications/${id}/read`, { method: 'POST' });
export const markAllNotificationsRead = () => apiFetch<void>('/notifications/read-all', { method: 'POST' });

export const savePushToken = (input: PushTokenInput) => apiFetch<void>('/push-tokens', { method: 'POST', json: input });
export const deletePushToken = (token: string) => apiFetch<void>('/push-tokens', { method: 'DELETE', json: { token } });
