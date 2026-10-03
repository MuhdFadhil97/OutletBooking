import type { LoginInput, SignupInput, SlugAvailabilityResponse } from '@outletbooking/shared';
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
