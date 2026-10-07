import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  slugSchema,
  type ForgotPasswordInput,
  type LoginInput,
  type ResetPasswordInput,
  type SignupInput,
} from '@outletbooking/shared';
import {
  changePassword,
  checkSlug,
  forgotPassword,
  getResetTokenInfo,
  login,
  logout,
  resetPassword,
  signup,
} from './api';
import { markOnboardingPending } from './onboarding';

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput & { rememberMe?: boolean }) => login(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

/** Creates the business, then signs in so the session is stored securely. Step 3 follows (`/welcome`). */
export function useSignup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SignupInput) => {
      await signup(input);
      // Before login: the new session triggers the redirect to `/`, which must already see this.
      markOnboardingPending();
      await login({ email: input.email, password: input.password, rememberMe: true });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSettled: () => qc.clear(),
  });
}

/** E1 · sends the reset email (same answer whether or not the email has an account). */
export function useForgotPassword() {
  return useMutation({ mutationFn: (input: ForgotPasswordInput) => forgotPassword(input) });
}

/** E2 · whose account the emailed link is for. Fails for used / expired links. */
export function useResetTokenInfo(token: string | undefined) {
  return useQuery({
    queryKey: ['reset-token', token],
    queryFn: () => getResetTokenInfo(token!),
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
  });
}

/** E2 · "Save & log in": set the new password, then log in on this device with it. */
export function useResetPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ResetPasswordInput) => {
      const { email } = await resetPassword(input);
      qc.clear(); // drop anything cached for whoever was logged in before
      await login({ email, password: input.newPassword, rememberMe: true });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

/** H6 · change password; optionally log out every other device. */
export function useChangePassword() {
  return useMutation({ mutationFn: changePassword });
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Live "Available / Already taken" check for the booking link. */
export function useSlugAvailability(slug: string) {
  const debounced = useDebounced(slug.trim().toLowerCase(), 400);
  const valid = slugSchema.safeParse(debounced).success;
  const query = useQuery({
    queryKey: ['slug-available', debounced],
    queryFn: () => checkSlug(debounced),
    enabled: valid,
    staleTime: 10_000,
  });
  const pending = debounced !== slug.trim().toLowerCase() || (valid && query.isFetching);
  return { valid, pending, available: valid && query.data?.available === true, data: query.data, error: query.error };
}
