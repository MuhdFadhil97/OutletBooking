import type { DeleteAccountInput } from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

/** H6 · Delete my account and business data (owner only). */
export function deleteAccount(input: DeleteAccountInput) {
  return apiFetch<void>('/me', { method: 'DELETE', json: input });
}
