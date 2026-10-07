import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DeleteAccountInput } from '@outletbooking/shared';
import { logout } from '@/features/auth/api';
import { deleteAccount } from './api';

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
