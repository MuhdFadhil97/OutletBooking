import type {
  Availability,
  Booking,
  BookingCreateInput,
  BookingRescheduleInput,
  BookingSearchFilter,
  BookingStatus,
  BookingUpdate,
} from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

const qs = (params: Record<string, string | number | boolean | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

/** Bookings overlapping local dates [from, to) ("yyyy-MM-dd", to exclusive). */
export const listBookings = (p: { from: string; to: string; resourceId?: number; includeInactive?: boolean }) =>
  apiFetch<Booking[]>(`/bookings?${qs(p)}`);

/** Bookings tab: search + filter, upcoming first then past. */
export const searchBookings = (p: { q?: string; filter: BookingSearchFilter; limit?: number }) =>
  apiFetch<Booking[]>(`/bookings/search?${qs({ ...p, q: p.q || undefined })}`);

export const getBooking = (id: number) => apiFetch<Booking>(`/bookings/${id}`);

export const getCalendarAvailability = (p: {
  serviceId: number;
  date: string;
  durationMin?: number;
  resourceId?: number;
  excludeBookingId?: number;
}) => apiFetch<Availability>(`/bookings/availability?${qs(p)}`);

export const createBooking = (body: BookingCreateInput) => apiFetch<Booking>('/bookings', { method: 'POST', json: body });

export const updateBooking = (id: number, body: BookingUpdate) =>
  apiFetch<Booking>(`/bookings/${id}`, { method: 'PATCH', json: body });

export const rescheduleBooking = (id: number, body: BookingRescheduleInput) =>
  apiFetch<Booking>(`/bookings/${id}/reschedule`, { method: 'POST', json: body });

export const setBookingStatus = (id: number, status: BookingStatus, reason?: string | null) =>
  apiFetch<Booking>(`/bookings/${id}/status`, { method: 'POST', json: { status, reason } });
