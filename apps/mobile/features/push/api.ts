import type { PushTokenInput } from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

export const savePushToken = (body: PushTokenInput) => apiFetch<void>('/me/push-token', { method: 'PUT', json: body });
export const deletePushToken = (token: string) => apiFetch<void>('/me/push-token', { method: 'DELETE', json: { token } });
