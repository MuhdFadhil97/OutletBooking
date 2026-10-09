import { Platform } from 'react-native';
import type {
  Booking,
  BookingAttachment,
  MySchedule,
  NotificationPrefs,
  NotificationPrefsUpdate,
} from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

/** S1 / G2 / G3: my bookings, hours and time off for local dates [from, to). */
export const getMySchedule = (from: string, to: string) => apiFetch<MySchedule>(`/me/schedule?from=${from}&to=${to}`);

/** S2 result notes; empty text clears them. */
export const setResultNotes = (bookingId: number, resultNotes: string) =>
  apiFetch<Booking>(`/bookings/${bookingId}/result`, { method: 'PUT', json: { resultNotes } });

export const listPhotos = (bookingId: number) => apiFetch<BookingAttachment[]>(`/bookings/${bookingId}/attachments`);

export interface PickedPhoto {
  uri: string;
  mimeType: string;
  fileName: string;
}

/** Multipart upload. Native: React Native's FormData takes { uri, name, type }; web needs a real Blob. */
export async function uploadPhoto(bookingId: number, photo: PickedPhoto): Promise<BookingAttachment> {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(photo.uri)).blob();
    form.append('file', blob, photo.fileName);
  } else {
    form.append('file', { uri: photo.uri, name: photo.fileName, type: photo.mimeType } as unknown as Blob);
  }
  return apiFetch<BookingAttachment>(`/bookings/${bookingId}/attachments`, { method: 'POST', body: form });
}

export const deletePhoto = (bookingId: number, attachmentId: number) =>
  apiFetch<null>(`/bookings/${bookingId}/attachments/${attachmentId}`, { method: 'DELETE' });

/** G3 push switches. */
export const getNotificationPrefs = () => apiFetch<NotificationPrefs>('/me/notification-prefs');
export const updateNotificationPrefs = (body: NotificationPrefsUpdate) =>
  apiFetch<NotificationPrefs>('/me/notification-prefs', { method: 'PUT', json: body });
