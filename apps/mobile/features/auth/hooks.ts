import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { slugSchema, type LoginInput, type SignupInput } from '@outletbooking/shared';
import { checkSlug, login, logout, signup } from './api';
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
