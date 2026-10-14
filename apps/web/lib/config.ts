import { SUPPORT_WHATSAPP } from '@outletbooking/shared';

const trimSlash = (url: string) => url.replace(/\/+$/, '');

/** OutletBooking API (contact form). */
export const API_URL = trimSlash(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000');
/** Owner app on the web (Expo web): sign-up, log in and public booking pages. */
export const APP_URL = trimSlash(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:8081');
const DEMO_SLUG = process.env.NEXT_PUBLIC_DEMO_SLUG ?? 'smash-arena-pj';

export const links = {
  signup: `${APP_URL}/signup`,
  login: `${APP_URL}/login`,
  demoBookingPage: `${APP_URL}/book/${DEMO_SLUG}`,
  /** Shown on the 404 page so people recognise a booking link. */
  bookingLinkExample: `${APP_URL.replace(/^https?:\/\//, '')}/book/business-name`,
  whatsapp: (text?: string) =>
    `https://wa.me/${SUPPORT_WHATSAPP.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`,
};
