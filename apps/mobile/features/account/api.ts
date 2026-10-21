import type { ChangeEmailInput, ChangePhoneInput, DeleteAccountInput } from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

/** H6 · Delete my account and business data (owner only). */
export function deleteAccount(input: DeleteAccountInput) {
  return apiFetch<void>('/me', { method: 'DELETE', json: input });
}

/** H6 · Ask to change the login email: a confirm link goes to the new address (owner only). */
export function requestEmailChange(input: ChangeEmailInput) {
  return apiFetch<void>('/me/email-change', { method: 'POST', json: input });
}

/** H6 · Change my mobile number (owner only). */
export function changePhone(input: ChangePhoneInput) {
  return apiFetch<void>('/me/phone', { method: 'PATCH', json: input });
}
