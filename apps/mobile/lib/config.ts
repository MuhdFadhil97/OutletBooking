import Constants from 'expo-constants';
import { Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_API_URL;

if (!url) {
  console.warn('EXPO_PUBLIC_API_URL is not set — copy apps/mobile/.env.example to apps/mobile/.env');
}

const configured = (url ?? 'http://localhost:3000').replace(/\/+$/, '');

/**
 * In dev on web, call the API on the same host as the page (e.g. localhost:8081 → localhost:3000).
 * The session cookie is SameSite=Lax, so a LAN-IP API from a localhost page would never get it back.
 */
function devWebApiUrl(base: string): string {
  if (!__DEV__ || typeof window === 'undefined' || !window.location?.hostname) return base;
  const api = new URL(base);
  if (api.hostname === window.location.hostname) return base;
  api.hostname = window.location.hostname;
  return api.toString().replace(/\/+$/, '');
}

/**
 * In dev on a phone (Expo Go / dev build), use the laptop address Metro was reached on.
 * The phone already loaded the app from it, and it keeps working when the laptop's LAN / hotspot
 * IP changes — no need to edit .env each time. Only for plain IP hosts (not --tunnel URLs);
 * the port still comes from EXPO_PUBLIC_API_URL (default 3000).
 */
function devNativeApiUrl(base: string): string {
  if (!__DEV__ || Platform.OS === 'web') return base;
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (!host || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return base;
  const api = new URL(base);
  api.hostname = host;
  return api.toString().replace(/\/+$/, '');
}

/** API base URL without trailing slash. */
export const API_URL = devNativeApiUrl(devWebApiUrl(configured));

/**
 * Where the shared booking link points. The booking page is the Expo web build of `app/book/[slug]`.
 * In dev it is served by Metro on the laptop (same host as the API, port 8081), so a phone on the
 * same Wi-Fi can open it. The production domain is not live yet; set EXPO_PUBLIC_BOOKING_URL when it is.
 */
function defaultBookingBase(): string {
  if (!__DEV__) return 'https://outletbooking.my';
  const dev = new URL(API_URL);
  dev.port = '8081';
  return dev.origin;
}

export const PUBLIC_BOOKING_BASE = (process.env.EXPO_PUBLIC_BOOKING_URL ?? defaultBookingBase()).replace(/\/+$/, '');

export const bookingUrl = (slug: string) => `${PUBLIC_BOOKING_BASE}/book/${slug}`;
export const bookingUrlLabel = (slug: string) => `${PUBLIC_BOOKING_BASE.replace(/^https?:\/\//, '')}/book/${slug}`;
