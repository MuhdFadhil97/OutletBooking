import { router } from 'expo-router';

/** Booking detail + form live in both the Calendar and Bookings tab stacks, so Back returns to the right list. */
export type BookingsTab = 'calendar' | 'bookings';

export function openBooking(tab: BookingsTab, id: number, how: 'push' | 'replace' = 'push') {
  const params = { id: String(id) };
  const go = how === 'push' ? router.push : router.replace;
  if (tab === 'calendar') go({ pathname: '/calendar/[id]', params });
  else go({ pathname: '/bookings/[id]', params });
}

export function openBookingForm(
  tab: BookingsTab,
  params: { date?: string; resourceId?: string; time?: string; bookingId?: string },
) {
  if (tab === 'calendar') router.push({ pathname: '/calendar/new', params });
  else router.push({ pathname: '/bookings/new', params });
}
