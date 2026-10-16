import type {
  AdminBusinessDetail,
  AdminBusinessesResponse,
  AcceptAdminInviteInput,
  AdminAccount,
  ChangeAdminPasswordInput,
  AdminPlanCatalog,
  AdminBusinessFilter,
  AdminInviteInfo,
  AdminRole,
  AdminUserRow,
  AdminUserOption,
  AuditEntry,
  AuditLogFilters,
  BookingPageInput,
  ChangeOwnerInput,
  ChangePlanInput,
  ExtendTrialInput,
  InviteAdminInput,
  FreeMonthsInput,
  SuspendInput,
  TrialFilter,
  TrialsResponse,
  UpdatePlansInput,
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

/** Set when the API said the session ended after 8 hours of no activity (FR-21.8); read once by the sign-in redirect. */
let idleExpired = false;
export function takeIdleExpired(): boolean {
  const value = idleExpired;
  idleExpired = false;
  return value;
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
    const json: unknown = await res.json().catch(() => null);
    if (res.status === 401 && errorCodeOf(json) === 'session_idle_expired') idleExpired = true;
    return { status: res.status, body: json };
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
  // A support admin on a super-admin page is still signed in: say why instead.
  if (r.status === 403 && errorCodeOf(r.body) === 'super_admin_only') return { kind: 'refused', message: errorMessageOf(r.body) ?? '' };
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

/** I7 */
export async function listTrials(q: string, filter: TrialFilter): Promise<Result<TrialsResponse>> {
  const params = new URLSearchParams({ filter });
  if (q.trim()) params.set('q', q.trim());
  return toResult(await call(`/admin/trials?${params}`));
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

/** I9 filters as a query string (empty values left out). */
export function auditParams(filters: AuditLogFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params;
}

/** I9: newest first; pass the last entry's id as `beforeId` to load older ones. */
export async function listAuditLog(filters: AuditLogFilters, limit: number, beforeId?: number): Promise<Result<AuditEntry[]>> {
  const params = auditParams(filters);
  params.set('limit', String(limit));
  if (beforeId) params.set('beforeId', String(beforeId));
  return toResult(await call(`/admin/audit-log?${params}`));
}

/** I9 "Admin" filter. */
export async function listAdmins(): Promise<Result<AdminUserOption[]>> {
  return toResult(await call('/admin/admins'));
}

/** I9 "Export CSV": the file the API builds for these filters (sent with the session cookie). */
export async function exportAuditLog(
  filters: AuditLogFilters,
): Promise<{ kind: 'ok'; file: Blob; filename: string } | { kind: 'signed_out' } | { kind: 'error' }> {
  if (!API_URL) return { kind: 'error' };
  try {
    const res = await fetch(`${API_URL}/admin/audit-log/export?${auditParams(filters)}`, { credentials: 'include' });
    if (res.status === 401 || res.status === 403) return { kind: 'signed_out' };
    if (!res.ok) return { kind: 'error' };
    const filename = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'audit-log.csv';
    return { kind: 'ok', file: await res.blob(), filename };
  } catch {
    return { kind: 'error' };
  }
}

/** I10 (super admins only) */
export async function listAdminUsers(): Promise<Result<AdminUserRow[]>> {
  return toResult(await call('/admin/users'));
}

export async function inviteAdmin(input: InviteAdminInput): Promise<Result<AdminUserRow[]>> {
  return toResult(await call('/admin/users', input));
}

export async function changeAdminRole(userId: number, role: AdminRole, reason: string): Promise<Result<AdminUserRow[]>> {
  return toResult(await call(`/admin/users/${userId}/role`, { role, reason }));
}

export type AdminUserAction = 'reset-two-factor' | 'remove' | 'resend-invite';

/** Reset two-step, remove (also cancels an invite) or resend an invite link. */
export async function adminUserAction(userId: number, action: AdminUserAction, reason: string): Promise<Result<AdminUserRow[]>> {
  return toResult(await call(`/admin/users/${userId}/${action}`, { reason }));
}

/** I10 invite link (public, no session). */
export type InviteResult = { kind: 'ok'; data: AdminInviteInfo } | { kind: 'invalid' } | { kind: 'expired' } | { kind: 'error' };
type InviteFailure = Exclude<InviteResult, { kind: 'ok' }>;

function inviteFailure(r: Reply): InviteFailure {
  if (r.status === 400 || r.status === 404) return { kind: 'invalid' };
  if (r.status === 410) return { kind: 'expired' };
  return { kind: 'error' };
}

export async function getAdminInvite(token: string): Promise<InviteResult> {
  const r = await call(`/admin-invite/${encodeURIComponent(token)}`);
  return r.status === 200 ? { kind: 'ok', data: r.body as AdminInviteInfo } : inviteFailure(r);
}

export async function acceptAdminInvite(token: string, input: AcceptAdminInviteInput): Promise<{ kind: 'ok' } | InviteFailure> {
  const r = await call(`/admin-invite/${encodeURIComponent(token)}/accept`, input);
  return r.status === 200 ? { kind: 'ok' } : inviteFailure(r);
}

/** I12 (super admins only) */
export async function getPlanCatalog(): Promise<Result<AdminPlanCatalog>> {
  return toResult(await call('/admin/plans'));
}

export async function savePlanCatalog(input: UpdatePlansInput): Promise<Result<AdminPlanCatalog>> {
  return toResult(await call('/admin/plans', input));
}

/** I29 My account (every admin) */
export async function getAccount(): Promise<Result<AdminAccount>> {
  return toResult(await call('/admin/account'));
}

export async function changePassword(input: ChangeAdminPasswordInput): Promise<Result<{ signedOutDevices: number }>> {
  return toResult(await call('/admin/account/password', input));
}

export async function makeNewBackupCodes(password: string): Promise<Result<{ backupCodes: string[] }>> {
  return toResult(await call('/admin/account/backup-codes', { password }));
}

export async function startMovePhone(password: string): Promise<Result<{ totpUri: string; expiresAt: string }>> {
  return toResult(await call('/admin/account/two-factor/move', { password }));
}

export async function confirmMovePhone(code: string): Promise<Result<{ backupCodes: string[]; signedOutDevices: number }>> {
  return toResult(await call('/admin/account/two-factor/move/confirm', { code }));
}

export async function signOutDevice(id: number): Promise<Result<{ ok: true }>> {
  return toResult(await call(`/admin/account/devices/${id}/sign-out`, {}));
}

export async function signOutOtherDevices(): Promise<Result<{ signedOut: number }>> {
  return toResult(await call('/admin/account/devices/sign-out-others', {}));
}
