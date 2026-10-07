import type {
  ForgotPasswordInput,
  LoginInput,
  ResetPasswordInput,
  ResetTokenInfo,
  SignupInput,
  SlugAvailabilityResponse,
} from '@outletbooking/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { authClient } from '@/lib/auth-client';

export function signup(input: SignupInput) {
  return apiFetch<{ slug: string; trialEndsAt: string }>('/signup', { method: 'POST', json: input });
}

export function checkSlug(slug: string) {
  return apiFetch<SlugAvailabilityResponse>(`/signup/slug-available?slug=${encodeURIComponent(slug)}`);
}

export async function login(input: LoginInput & { rememberMe?: boolean }) {
  const { error } = await authClient.signIn.email({
    email: input.email,
    password: input.password,
    rememberMe: input.rememberMe ?? true,
  });
  if (error) throw new ApiError(error.status ?? 400, error.code ?? 'login_failed', error.message ?? 'Login failed');
}

export async function logout() {
  await authClient.signOut();
}

// E1 / E2 · password reset by email link (public API routes)
export function forgotPassword(input: ForgotPasswordInput) {
  return apiFetch<{ ok: true }>('/password/forgot', { method: 'POST', json: input });
}

export function getResetTokenInfo(token: string) {
  return apiFetch<ResetTokenInfo>(`/password/reset/${encodeURIComponent(token)}`);
}

export function resetPassword(input: ResetPasswordInput) {
  return apiFetch<ResetTokenInfo>('/password/reset', { method: 'POST', json: input });
}

// H6 · change password while logged in (Better Auth; keeps this device logged in)
export async function changePassword(input: { currentPassword: string; newPassword: string; revokeOtherSessions: boolean }) {
  const { error } = await authClient.changePassword(input);
  if (error) {
    throw new ApiError(error.status ?? 400, error.code ?? 'change_password_failed', error.message ?? 'Could not change password');
  }
}
