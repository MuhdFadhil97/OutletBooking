import type {
  AdminBusinessDetail,
  AdminBusinessesResponse,
  AdminBusinessFilter,
  BookingPageInput,
  ChangeOwnerInput,
  ChangePlanInput,
  ExtendTrialInput,
  FreeMonthsInput,
  SuspendInput,
} from '@outletbooking/shared';
import { API_URL } from './config';

/**
 * Platform admin calls from the browser (apps/web /admin). Better Auth keeps the session in an httpOnly
 * cookie on the API's domain, so every call sends credentials. The website must be in the API's
 * TRUSTED_ORIGINS and on the same site as the API (localhost:3001 → :3000; later outletbooking.my → api.outletbooking.my).
 */

export interface Reply {
  /** 0 = no connection (or no API configured). */
  status: number;
  body: unknown;
}

export async function call(path: string, body?: unknown): Promise<Reply> {
  if (!API_URL) return { status: 0, body: null };
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return { status: 0, body: null };
  }
}

/** Error code from either Better Auth (`{ code }`) or our API (`{ error: { code } }`). */
export function errorCodeOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as { code?: unknown; error?: { code?: unknown } };
  if (typeof b.error?.code === 'string') return b.error.code;
  return typeof b.code === 'string' ? b.code : null;
}

/** Our API's `{ error: { message } }`, e.g. "Pick a date after the current trial end". */
export function errorMessageOf(body: unknown): string | null {
  const m = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof m === 'string' ? m : null;
}

export type Result<T> =
  | { kind: 'ok'; data: T }
  /** No admin session (or it lost access): go to /admin/login. */
  | { kind: 'signed_out' }
  | { kind: 'not_found' }
  /** Refused by the API with a message to show (validation, "already paused", …). */
  | { kind: 'refused'; message: string }
  | { kind: 'error' };

function toResult<T>(r: Reply): Result<T> {
  if (r.status >= 200 && r.status < 300) return { kind: 'ok', data: r.body as T };
  if (r.status === 401 || r.status === 403) return { kind: 'signed_out' };
  if (r.status === 404) return { kind: 'not_found' };
  const message = errorMessageOf(r.body);
  if (r.status >= 400 && r.status < 500 && message) return { kind: 'refused', message };
  return { kind: 'error' };
}

/** I1 */
export async function listBusinesses(q: string, filter: AdminBusinessFilter): Promise<Result<AdminBusinessesResponse>> {
  const params = new URLSearchParams({ filter });
  if (q.trim()) params.set('q', q.trim());
  return toResult(await call(`/admin/businesses?${params}`));
}

/** I2 */
export async function getBusiness(id: number): Promise<Result<AdminBusinessDetail>> {
  return toResult(await call(`/admin/businesses/${id}`));
}

export async function extendTrial(id: number, input: ExtendTrialInput): Promise<Result<AdminBusinessDetail>> {
  return toResult(await call(`/admin/businesses/${id}/extend-trial`, input));
}

export async function setBookingPage(id: number, input: BookingPageInput): Promise<Result<AdminBusinessDetail>> {
  return toResult(await call(`/admin/businesses/${id}/booking-page`, input));
}

export async function addNote(id: number, reason: string): Promise<Result<AdminBusinessDetail>> {
  return toResult(await call(`/admin/businesses/${id}/notes`, { reason }));
}

export async function giveFreeMonths(id: number, input: FreeMonthsInput): Promise<Result<AdminBusinessDetail>> {
  return toResult(await call(`/admin/businesses/${id}/free-months`, input));
}

export async function changePlan(id: number, input: ChangePlanInput): Promise<Result<AdminBusinessDetail>> {
  return toResult(await call(`/admin/businesses/${id}/change-plan`, input));
}

/** Locks the owner/staff app and the booking page; the owner sees the reason. */
export async function suspendBusiness(id: number, input: SuspendInput): Promise<Result<AdminBusinessDetail>> {
  return toResult(await call(`/admin/businesses/${id}/suspend`, input));
}

export async function unsuspendBusiness(id: number, reason: string): Promise<Result<AdminBusinessDetail>> {
  return toResult(await call(`/admin/businesses/${id}/unsuspend`, { reason }));
}

export async function changeOwner(id: number, input: ChangeOwnerInput): Promise<Result<AdminBusinessDetail>> {
  return toResult(await call(`/admin/businesses/${id}/change-owner`, input));
}

/** Emails the owner M1 "Confirm your email" again (refused once confirmed). */
export async function resendConfirmEmail(id: number, reason: string): Promise<Result<AdminBusinessDetail>> {
  return toResult(await call(`/admin/businesses/${id}/confirm-email`, { reason }));
}

/** Emails the owner the same reset link as E1 "Forgot password". */
export async function sendOwnerPasswordReset(id: number, reason: string): Promise<Result<AdminBusinessDetail>> {
  return toResult(await call(`/admin/businesses/${id}/password-reset`, { reason }));
}
