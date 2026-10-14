import { SUPPORT_WHATSAPP } from '@outletbooking/shared';

const trimSlash = (url: string) => url.replace(/\/+$/, '');
const isDev = process.env.NODE_ENV !== 'production';

/** Env URL, or the local default in development. Unset in production = not live yet (pre-launch mode). */
const urlFromEnv = (value: string | undefined, devDefault: string): string | null =>
  value ? trimSlash(value) : isDev ? devDefault : null;

/** OutletBooking API (contact form). */
export const API_URL = urlFromEnv(process.env.NEXT_PUBLIC_API_URL, 'http://localhost:3000');
/** Owner app on the web (Expo web): sign-up, log in and public booking pages. */
export const APP_URL = urlFromEnv(process.env.NEXT_PUBLIC_APP_URL, 'http://localhost:8081');
const DEMO_SLUG = process.env.NEXT_PUBLIC_DEMO_SLUG ?? 'smash-arena-pj';

/**
 * Pre-launch: the app is not online yet, so "Start free trial" / "Log in" become "Book a demo"
 * and the sample booking page is hidden. Set NEXT_PUBLIC_APP_URL and redeploy to switch.
 */
export const appLive = APP_URL !== null;
/** Without the API the contact page offers WhatsApp instead of the form. */
export const apiLive = API_URL !== null;

export const links = {
  signup: APP_URL ? `${APP_URL}/signup` : null,
  login: APP_URL ? `${APP_URL}/login` : null,
  demoBookingPage: APP_URL ? `${APP_URL}/book/${DEMO_SLUG}` : null,
  bookDemo: '/contact?reason=demo',
  /** Shown on the 404 page so people recognise a booking link. */
  bookingLinkExample: `${(APP_URL ?? 'https://outletbooking.my').replace(/^https?:\/\//, '')}/book/business-name`,
  whatsapp: (text?: string) =>
    `https://wa.me/${SUPPORT_WHATSAPP.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`,
};
