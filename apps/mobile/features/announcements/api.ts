import type { ActiveAnnouncement } from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

/** I28 · Notices from FTech for this owner's business (banner at the top of Today). */
export const listActiveAnnouncements = () => apiFetch<ActiveAnnouncement[]>('/announcements/active');
export const dismissAnnouncement = (id: number) => apiFetch<void>(`/announcements/${id}/dismiss`, { method: 'POST', json: {} });
