import type {
  Availability,
  PaymentLink,
  NextAvailableSlot,
  PriceQuote,
  PublicBookingConfirmation,
  PublicBookingCreateInput,
  PublicBusiness,
} from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';
import { API_URL } from '@/lib/config';

// Public booking page (no login)
const qs = (params: Record<string, string | number | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
const slugPath = (slug: string) => `/public/${encodeURIComponent(slug)}`;

export const getPublicBusiness = (slug: string) => apiFetch<PublicBusiness>(slugPath(slug));

export const getPublicSlots = (slug: string, p: { serviceId: number; date: string; durationMin?: number; resourceId?: number }) =>
  apiFetch<Availability>(`${slugPath(slug)}/slots?${qs(p)}`);

/** F2: first free times after `date`. */
export const getPublicNextAvailable = (
  slug: string,
  p: { serviceId: number; date: string; durationMin?: number; resourceId?: number },
) => apiFetch<NextAvailableSlot[]>(`${slugPath(slug)}/next-available?${qs(p)}`);

export const getPublicQuote = (slug: string, p: { serviceId: number; startAt: string; durationMin?: number }) =>
  apiFetch<PriceQuote>(`${slugPath(slug)}/quote?${qs(p)}`);

export const createPublicBooking = (slug: string, body: PublicBookingCreateInput) =>
  apiFetch<PublicBookingConfirmation>(`${slugPath(slug)}/bookings`, { method: 'POST', json: body });

export const getPublicBooking = (token: string) => apiFetch<PublicBookingConfirmation>(`/public/bookings/${token}`);

export const cancelPublicBooking = (token: string) =>
  apiFetch<PublicBookingConfirmation>(`/public/bookings/${token}/cancel`, { method: 'POST', json: {} });

/** "Add to calendar" file — opened directly by the browser. */
export const calendarFileUrl = (token: string) => `${API_URL}/public/bookings/${token}/calendar.ics`;

/** C3 / F4: a ToyyibPay bill for the amount due (reuses the open one). */
export const payPublicBooking = (token: string) =>
  apiFetch<PaymentLink>(`/public/bookings/${token}/pay`, { method: 'POST', json: {} });

/** Back from ToyyibPay: the API re-checks the bill, then returns the booking. */
export const checkPublicPayment = (token: string) =>
  apiFetch<PublicBookingConfirmation>(`/public/bookings/${token}/payment-check`, { method: 'POST', json: {} });
