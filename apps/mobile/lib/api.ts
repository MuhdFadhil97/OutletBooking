import { Platform } from 'react-native';
import type { ApiError as ApiErrorBody } from '@outletbooking/shared';
import { authClient } from './auth-client';
import { API_URL } from './config';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * The only way the app talks to the backend. Adds the session cookie
 * (from SecureStore on native, browser cookie on web) and normalises errors.
 */
export async function apiFetch<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  if (Platform.OS !== 'web') {
    const cookie = await authClient.getCookie();
    if (cookie) headers.set('cookie', cookie);
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      credentials: Platform.OS === 'web' ? 'include' : 'omit',
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Network request failed');
  }

  const text = await res.text();
  const data: unknown = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
