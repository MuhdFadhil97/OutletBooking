import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChangeEmailInput, ChangePhoneInput, DeleteAccountInput } from '@outletbooking/shared';
import { logout } from '@/features/auth/api';
import { changePhone, deleteAccount, requestEmailChange } from './api';

/** Deletes the account, then clears the local session and every cached query. */
export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeleteAccountInput) => {
      await deleteAccount(input);
      // The server already removed the sessions; this clears the token stored on the phone.
      await logout().catch(() => undefined);
    },
    onSuccess: () => qc.clear(),
  });
}

/** The login email only changes once the new address confirms, so nothing to refresh here. */
export function useRequestEmailChange() {
  return useMutation({ mutationFn: (input: ChangeEmailInput) => requestEmailChange(input) });
}

export function useChangePhone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ChangePhoneInput) => changePhone(input),
    // The business profile (E5) may have followed the new number.
    onSuccess: () => qc.invalidateQueries(),
  });
}
