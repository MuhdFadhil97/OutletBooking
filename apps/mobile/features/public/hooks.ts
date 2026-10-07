import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicBookingConfirmation, PublicBookingCreateInput } from '@outletbooking/shared';
import * as api from './api';

export const usePublicBusiness = (slug: string) =>
  useQuery({ queryKey: ['public-business', slug], queryFn: () => api.getPublicBusiness(slug), enabled: !!slug });

export const usePublicSlots = (
  slug: string,
  p: { serviceId: number; date: string; durationMin?: number; resourceId?: number } | null,
) =>
  useQuery({
    queryKey: ['public-slots', slug, p],
    queryFn: () => api.getPublicSlots(slug, p!),
    enabled: !!p,
    // Others are booking too: refresh when the customer comes back to the page.
    staleTime: 30_000,
  });

export const usePublicQuote = (slug: string, p: { serviceId: number; startAt: string; durationMin?: number } | null) =>
  useQuery({ queryKey: ['public-quote', slug, p], queryFn: () => api.getPublicQuote(slug, p!), enabled: !!p });

export function useCreatePublicBooking(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PublicBookingCreateInput) => api.createPublicBooking(slug, body),
    // The confirmation page opens with this data (incl. the name only the booking response has).
    onSuccess: (b) => qc.setQueryData(['public-booking', b.token], b),
    onSettled: () => qc.invalidateQueries({ queryKey: ['public-slots', slug] }),
  });
}

export function usePublicBooking(token: string) {
  const qc = useQueryClient();
  const queryKey = ['public-booking', token];
  return useQuery({
    queryKey,
    queryFn: async () => {
      // The API never returns the name for a link; keep the one typed in this browser session.
      const prev = qc.getQueryData<PublicBookingConfirmation>(queryKey);
      const b = await api.getPublicBooking(token);
      return { ...b, customerName: prev?.customerName ?? null };
    },
    enabled: !!token,
  });
}

export function useCancelPublicBooking(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.cancelPublicBooking(token),
    onSuccess: (b) =>
      qc.setQueryData<PublicBookingConfirmation>(['public-booking', token], (old) => ({ ...b, customerName: old?.customerName ?? null })),
  });
}
