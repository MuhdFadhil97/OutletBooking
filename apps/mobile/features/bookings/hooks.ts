import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Booking, BookingCreateInput, BookingRescheduleInput, BookingStatus } from '@outletbooking/shared';
import { getWorkingHours } from '@/features/setup/api';
import { setupKeys } from '@/features/setup/hooks';
import * as api from './api';

export const bookingKeys = {
  all: ['bookings'] as const,
  range: (from: string, to: string) => ['bookings', 'range', from, to] as const,
  detail: (id: number) => ['bookings', 'detail', id] as const,
  availability: (p: object) => ['bookings', 'availability', p] as const,
};

/** Calendar data for local dates [from, to). Refreshes when the screen comes back into focus. */
export const useBookingsRange = (from: string, to: string) =>
  useQuery({ queryKey: bookingKeys.range(from, to), queryFn: () => api.listBookings({ from, to }) });

export const useBooking = (id: number) =>
  useQuery({ queryKey: bookingKeys.detail(id), queryFn: () => api.getBooking(id), enabled: id > 0 });

export function useCalendarAvailability(p: Parameters<typeof api.getCalendarAvailability>[0] | null) {
  return useQuery({
    queryKey: bookingKeys.availability(p ?? {}),
    queryFn: () => api.getCalendarAvailability(p!),
    enabled: p !== null,
  });
}

/** Working hours of several resources (sets the visible hours of the day view). */
export function useResourcesHours(resourceIds: number[]) {
  return useQueries({
    queries: resourceIds.map((id) => ({ queryKey: setupKeys.hours(id), queryFn: () => getWorkingHours(id) })),
  });
}

/** Any change to a booking refreshes every calendar range and slot list. */
function useOnBookingChanged() {
  const qc = useQueryClient();
  return (b: Booking) => {
    qc.setQueryData(bookingKeys.detail(b.id), b);
    void qc.invalidateQueries({ queryKey: ['bookings', 'range'] });
    void qc.invalidateQueries({ queryKey: ['bookings', 'availability'] });
  };
}

export function useCreateBooking() {
  const onChanged = useOnBookingChanged();
  return useMutation({ mutationFn: (body: BookingCreateInput) => api.createBooking(body), onSuccess: onChanged });
}

export function useRescheduleBooking(id: number) {
  const onChanged = useOnBookingChanged();
  return useMutation({
    mutationFn: (body: BookingRescheduleInput) => api.rescheduleBooking(id, body),
    onSuccess: onChanged,
  });
}

export function useSetBookingStatus(id: number) {
  const onChanged = useOnBookingChanged();
  return useMutation({
    mutationFn: ({ status, reason }: { status: BookingStatus; reason?: string | null }) =>
      api.setBookingStatus(id, status, reason),
    onSuccess: onChanged,
  });
}
