import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicBookingCreateInput } from '@outletbooking/shared';
import * as api from './api';

export const usePublicBusiness = (slug: string) =>
  useQuery({ queryKey: ['public-business', slug], queryFn: () => api.getPublicBusiness(slug), enabled: !!slug });

type SlotParams = { serviceId: number; date: string; durationMin?: number; resourceId?: number };

/** Free times for one day; refreshed often because other customers book too. */
export const usePublicSlots = (slug: string, p: SlotParams | null) =>
  useQuery({
    queryKey: ['public-slots', slug, p],
    queryFn: () => api.getPublicSlots(slug, p!),
    enabled: !!p,
    staleTime: 15_000,
  });

/** F2 · "Next available": the following days, only fetched when the chosen day is full. */
export const usePublicSlotsForDays = (slug: string, base: Omit<SlotParams, 'date'> | null, dates: string[]) =>
  useQueries({
    queries: dates.map((date) => ({
      queryKey: ['public-slots', slug, { ...base, date }],
      queryFn: () => api.getPublicSlots(slug, { ...base!, date }),
      enabled: !!base,
      staleTime: 15_000,
    })),
  });

export function useCreatePublicBooking(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PublicBookingCreateInput) => api.createPublicBooking(slug, body),
    onSuccess: (b) => {
      qc.setQueryData(['public-booking', b.token], b);
      void qc.invalidateQueries({ queryKey: ['public-slots', slug] });
    },
  });
}

export const usePublicBooking = (token: string) =>
  useQuery({ queryKey: ['public-booking', token], queryFn: () => api.getPublicBooking(token), enabled: !!token });

export function useCancelPublicBooking(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.cancelPublicBooking(token),
    onSuccess: (b) => qc.setQueryData(['public-booking', token], b),
  });
}
