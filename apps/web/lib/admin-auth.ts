import { ADMIN_AUTH_ERRORS, type AdminMe } from '@outletbooking/shared';
import { API_URL } from './config';

/**
 * I5 / I6 admin sign-in, called from the browser. Better Auth keeps the session in an httpOnly cookie
 * on the API's domain, so every call sends credentials. The website must be in the API's TRUSTED_ORIGINS
 * and on the same site as the API (localhost:3001 → localhost:3000; later outletbooking.my → api.outletbooking.my).
 */

/** Error code from either Better Auth (`{ code }`) or our API (`{ error: { code } }`). */
export function errorCodeOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as { code?: unknown; error?: { code?: unknown } };
  if (typeof b.error?.code === 'string') return b.error.code;
  return typeof b.code === 'string' ? b.code : null;
}

/** Setup key from an otpauth:// URI, in groups of 4 so it is easy to type into an authenticator app. */
export function setupKeyOf(totpUri: string): string {
  try {
    const secret = new URL(totpUri).searchParams.get('secret') ?? '';
    return (secret.match(/.{1,4}/g) ?? []).join(' ');
  } catch {
    return '';
  }
}

interface Reply {
  status: number;
  body: unknown;
}

async function call(path: string, body?: unknown): Promise<Reply> {
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

export type PasswordResult =
  | { kind: 'two_factor' }
  | { kind: 'signed_in' }
  | { kind: 'wrong' }
  | { kind: 'locked'; message: string }
  | { kind: 'error' };

/** I5: email + password. Admins with two-step on get a code challenge; first-time admins get a session. */
export async function signInWithPassword(email: string, password: string): Promise<PasswordResult> {
  const r = await call('/api/auth/sign-in/email', { email, password });
  if (r.status === 200) {
    return (r.body as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect ? { kind: 'two_factor' } : { kind: 'signed_in' };
  }
  if (r.status === 401) return { kind: 'wrong' };
  if (r.status === 429 && errorCodeOf(r.body) === ADMIN_AUTH_ERRORS.accountLocked) {
    return { kind: 'locked', message: (r.body as { error: { message: string } }).error.message };
  }
  return { kind: 'error' };
}

export type CodeResult = { kind: 'ok' } | { kind: 'wrong' } | { kind: 'locked' } | { kind: 'expired' } | { kind: 'error' };

/** I6: a code from the authenticator app (sign-in or first setup) or a backup code (sign-in only). */
export async function verifyCode(code: string, kind: 'totp' | 'backup'): Promise<CodeResult> {
  const path = kind === 'totp' ? '/api/auth/two-factor/verify-totp' : '/api/auth/two-factor/verify-backup-code';
  const r = await call(path, { code: code.trim() });
  if (r.status === 200) return { kind: 'ok' };
  const err = errorCodeOf(r.body);
  // The challenge cookie lasts 10 minutes, and 5 wrong codes end it.
  if (err === 'INVALID_TWO_FACTOR_COOKIE' || err === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE') return { kind: 'expired' };
  if (r.status === 429) return { kind: 'locked' };
  if (r.status === 401) return { kind: 'wrong' };
  return { kind: 'error' };
}

export type SetupResult = { kind: 'ok'; totpUri: string; backupCodes: string[] } | { kind: 'error' };

/** I6 first sign-in: creates the authenticator secret and 10 backup codes (turned on after the first code). */
export async function startTwoFactorSetup(password: string): Promise<SetupResult> {
  const r = await call('/api/auth/two-factor/enable', { password });
  const body = r.body as { totpURI?: string; backupCodes?: string[] } | null;
  if (r.status === 200 && body?.totpURI && body.backupCodes) {
    return { kind: 'ok', totpUri: body.totpURI, backupCodes: body.backupCodes };
  }
  return { kind: 'error' };
}

export type MeResult =
  | { kind: 'ok'; admin: AdminMe }
  | { kind: 'signed_out' }
  | { kind: 'setup_required' }
  | { kind: 'not_admin' }
  | { kind: 'error' };

export async function getAdminMe(): Promise<MeResult> {
  const r = await call('/admin/me');
  if (r.status === 200) return { kind: 'ok', admin: r.body as AdminMe };
  if (r.status === 401) return { kind: 'signed_out' };
  if (r.status === 403) {
    return errorCodeOf(r.body) === ADMIN_AUTH_ERRORS.twoFactorSetupRequired ? { kind: 'setup_required' } : { kind: 'not_admin' };
  }
  return { kind: 'error' };
}

export async function signOut(): Promise<void> {
  await call('/api/auth/sign-out', {});
}
