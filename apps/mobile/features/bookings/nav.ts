import { router } from 'expo-router';

/**
 * Booking detail + form live in the Today, Calendar and Bookings tab stacks,
 * so Back returns to the screen the owner came from.
 */
export type BookingsTab = 'today' | 'calendar' | 'bookings';

export type BookingFormParams = {
  date?: string;
  resourceId?: string;
  time?: string;
  bookingId?: string;
  /** "1" = walk-in mode (today, start now, any free resource). */
  walkIn?: string;
  /** D11 "Book": fill in this customer (an id, never name/phone: params end up in the web URL). */
  customerId?: string;
};

export function openBooking(tab: BookingsTab, id: number, how: 'push' | 'replace' = 'push') {
  const params = { id: String(id) };
  const go = how === 'push' ? router.push : router.replace;
  if (tab === 'today') go({ pathname: '/today/[id]', params });
  else if (tab === 'calendar') go({ pathname: '/calendar/[id]', params });
  else go({ pathname: '/bookings/[id]', params });
}

export function openBookingForm(tab: BookingsTab, params: BookingFormParams) {
  if (tab === 'today') router.push({ pathname: '/today/new', params });
  else if (tab === 'calendar') router.push({ pathname: '/calendar/new', params });
  else router.push({ pathname: '/bookings/new', params });
}
