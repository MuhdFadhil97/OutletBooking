const url = process.env.EXPO_PUBLIC_API_URL;

if (!url) {
  console.warn('EXPO_PUBLIC_API_URL is not set — copy apps/mobile/.env.example to apps/mobile/.env');
}

/** API base URL without trailing slash. */
export const API_URL = (url ?? 'http://localhost:3000').replace(/\/+$/, '');

/** Public booking page base. Domain is not registered yet; keep configurable. */
export const PUBLIC_BOOKING_BASE = (process.env.EXPO_PUBLIC_BOOKING_URL ?? 'https://outletbooking.my').replace(/\/+$/, '');

export const bookingUrl = (slug: string) => `${PUBLIC_BOOKING_BASE}/book/${slug}`;
export const bookingUrlLabel = (slug: string) => `${PUBLIC_BOOKING_BASE.replace(/^https?:\/\//, '')}/book/${slug}`;
