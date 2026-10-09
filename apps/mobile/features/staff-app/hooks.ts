import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Booking, NotificationPrefs, NotificationPrefsUpdate } from '@outletbooking/shared';
import { bookingKeys } from '@/features/bookings/hooks';
import * as api from './api';

export const staffKeys = {
  // Under ['bookings', 'range'] so every booking change (check in, complete…) refreshes it too.
  schedule: (from: string, to: string) => [...bookingKeys.range(from, to), 'mine'] as const,
  photos: (bookingId: number) => ['bookings', 'photos', bookingId] as const,
  prefs: ['me', 'notification-prefs'] as const,
};

export const useMySchedule = (from: string, to: string) =>
  useQuery({ queryKey: staffKeys.schedule(from, to), queryFn: () => api.getMySchedule(from, to) });

export function useSetResultNotes(bookingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notes: string) => api.setResultNotes(bookingId, notes),
    onSuccess: (b: Booking) => {
      qc.setQueryData(bookingKeys.detail(b.id), b);
      void qc.invalidateQueries({ queryKey: ['bookings', 'range'] });
    },
  });
}

export const usePhotos = (bookingId: number) =>
  useQuery({ queryKey: staffKeys.photos(bookingId), queryFn: () => api.listPhotos(bookingId), enabled: bookingId > 0 });

export function useUploadPhoto(bookingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photo: api.PickedPhoto) => api.uploadPhoto(bookingId, photo),
    onSuccess: () => void qc.invalidateQueries({ queryKey: staffKeys.photos(bookingId) }),
  });
}

export function useDeletePhoto(bookingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: number) => api.deletePhoto(bookingId, attachmentId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: staffKeys.photos(bookingId) }),
  });
}

export const useNotificationPrefs = () => useQuery({ queryKey: staffKeys.prefs, queryFn: api.getNotificationPrefs });

/** Flips the switch straight away; rolls back if the save fails. */
export function useUpdateNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NotificationPrefsUpdate) => api.updateNotificationPrefs(body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: staffKeys.prefs });
      const before = qc.getQueryData<NotificationPrefs>(staffKeys.prefs);
      if (before) qc.setQueryData<NotificationPrefs>(staffKeys.prefs, { ...before, ...body });
      return { before };
    },
    onError: (_e, _b, ctx) => {
      if (ctx?.before) qc.setQueryData(staffKeys.prefs, ctx.before);
    },
    onSuccess: (prefs) => qc.setQueryData(staffKeys.prefs, prefs),
  });
}
