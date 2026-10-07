import type {
  PublicAvailability,
  PublicBookingConfirmation,
  PublicBookingCreateInput,
  PublicBusiness,
} from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

// Public booking page (no login)
const enc = encodeURIComponent;
export const getPublicBusiness = (slug: string) => apiFetch<PublicBusiness>(`/public/${enc(slug)}`);
export const getPublicSlots = (slug: string, p: { serviceId: number; date: string; durationMin?: number; resourceId?: number }) =>
  apiFetch<PublicAvailability>(
    `/public/${enc(slug)}/slots?serviceId=${p.serviceId}&date=${p.date}` +
      (p.durationMin ? `&durationMin=${p.durationMin}` : '') +
      (p.resourceId ? `&resourceId=${p.resourceId}` : ''),
  );
export const createPublicBooking = (slug: string, body: PublicBookingCreateInput) =>
  apiFetch<PublicBookingConfirmation>(`/public/${enc(slug)}/bookings`, { method: 'POST', json: body });

// F5 · the customer's own booking, by token
export const getPublicBooking = (token: string) => apiFetch<PublicBookingConfirmation>(`/public/bookings/${enc(token)}`);
export const cancelPublicBooking = (token: string) =>
  apiFetch<PublicBookingConfirmation>(`/public/bookings/${enc(token)}/cancel`, { method: 'POST', json: {} });
