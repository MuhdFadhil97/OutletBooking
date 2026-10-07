import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Booking,
  BookingCancelInput,
  BookingCreateInput,
  BookingRescheduleInput,
  BookingSearchFilter,
  BookingStatus,
} from '@outletbooking/shared';
import { getWorkingHours } from '@/features/setup/api';
import { setupKeys } from '@/features/setup/hooks';
import * as api from './api';

export const bookingKeys = {
  all: ['bookings'] as const,
  range: (from: string, to: string) => ['bookings', 'range', from, to] as const,
  detail: (id: number) => ['bookings', 'detail', id] as const,
  events: (id: number) => ['bookings', 'events', id] as const,
  search: (q: string, filter: string) => ['bookings', 'search', q, filter] as const,
  availability: (p: object) => ['bookings', 'availability', p] as const,
};

/** Calendar data for local dates [from, to). Refreshes when the screen comes back into focus. */
export const useBookingsRange = (from: string, to: string) =>
  useQuery({ queryKey: bookingKeys.range(from, to), queryFn: () => api.listBookings({ from, to }) });

/** Today dashboard: one day incl. cancelled / no-show (for the no-show count). */
export const useDayBookingsAll = (date: string, nextDate: string) =>
  useQuery({
    queryKey: [...bookingKeys.range(date, nextDate), 'all'],
    queryFn: () => api.listBookings({ from: date, to: nextDate, includeInactive: true }),
  });

export const SEARCH_LIMIT = 50;

/** Keeps showing the previous results while a new search loads (no flicker while typing). */
export const useBookingSearch = (q: string, filter: BookingSearchFilter) =>
  useQuery({
    queryKey: bookingKeys.search(q, filter),
    queryFn: () => api.searchBookings({ q, filter, limit: SEARCH_LIMIT }),
    placeholderData: keepPreviousData,
  });

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
    void qc.invalidateQueries({ queryKey: bookingKeys.events(b.id) });
    void qc.invalidateQueries({ queryKey: ['bookings', 'range'] });
    void qc.invalidateQueries({ queryKey: ['bookings', 'search'] });
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

/** H8 · booking history (oldest first). */
export const useBookingEvents = (id: number) =>
  useQuery({ queryKey: bookingKeys.events(id), queryFn: () => api.getBookingEvents(id), enabled: id > 0 });

/** D4 · cancel with reason and optional refund. */
export function useCancelBooking(id: number) {
  const onChanged = useOnBookingChanged();
  return useMutation({ mutationFn: (body: BookingCancelInput) => api.cancelBooking(id, body), onSuccess: onChanged });
}
