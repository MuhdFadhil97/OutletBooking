import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AcceptInviteNewAccount, MemberUpdate } from '@outletbooking/shared';
import { login } from '@/features/auth/api';
import { setupKeys } from '@/features/setup/hooks';
import * as api from './api';

const staffKey = ['staff'] as const;

export const useStaff = () => useQuery({ queryKey: staffKey, queryFn: api.listStaff });

export function useInviteStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.inviteStaff,
    onSuccess: () => qc.invalidateQueries({ queryKey: staffKey }),
  });
}

export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.revokeInvitation,
    onSuccess: () => qc.invalidateQueries({ queryKey: staffKey }),
  });
}

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, ...body }: MemberUpdate & { memberId: number }) => api.updateMember(memberId, body),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: staffKey }),
        // Resource cards show the linked staff login
        qc.invalidateQueries({ queryKey: setupKeys.resources }),
      ]),
  });
}

export const useInvitation = (token: string) =>
  useQuery({ queryKey: ['invitation', token], queryFn: () => api.getInvitation(token), enabled: !!token });

/** New account: accept (creates the login), then sign in. Existing: sign in first, then accept. */
export function useAcceptInvitation(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: { kind: 'new'; email: string; account: AcceptInviteNewAccount } | { kind: 'existing'; email: string; password?: string },
    ) => {
      if (input.kind === 'new') {
        await api.acceptInvitation(token, input.account);
        await login({ email: input.email, password: input.account.password, rememberMe: true });
      } else {
        if (input.password) await login({ email: input.email, password: input.password, rememberMe: true });
        await api.acceptInvitation(token, {});
      }
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}
