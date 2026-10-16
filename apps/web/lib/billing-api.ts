import type {
  BillingHistory,
  BillingOverview,
  BillingPayment,
  CheckoutInput,
  CheckoutResult,
  ReceiptDetailsInput,
} from '@outletbooking/shared';
import { call, errorCodeOf, errorMessageOf, type Reply } from './admin-api';
import { API_URL } from './config';

/**
 * Plan payment pages (I4, I13–I17), called from the browser. The one-time email link sets a Better Auth
 * session cookie on the API's domain, so every call sends credentials (same setup as the admin panel).
 */

export type BillingResult<T> =
  | { kind: 'ok'; data: T }
  /** No session (or it ended): go to /billing/sign-in. */
  | { kind: 'signed_out' }
  | { kind: 'not_found' }
  /** Refused with a message to show (staff trying to pay, validation, payment not set up…). */
  | { kind: 'refused'; code: string | null; message: string }
  | { kind: 'error' };

function toResult<T>(r: Reply): BillingResult<T> {
  if (r.status >= 200 && r.status < 300) return { kind: 'ok', data: r.body as T };
  if (r.status === 401) return { kind: 'signed_out' };
  if (r.status === 404) return { kind: 'not_found' };
  const message = errorMessageOf(r.body);
  if (r.status >= 400 && r.status < 500 && message) return { kind: 'refused', code: errorCodeOf(r.body), message };
  return { kind: 'error' };
}

export async function getOverview(): Promise<BillingResult<BillingOverview>> {
  return toResult(await call('/billing/overview'));
}

export async function getHistory(): Promise<BillingResult<BillingHistory>> {
  return toResult(await call('/billing/payments'));
}

/** One payment by its ToyyibPay bill code. A pending one is re-checked with ToyyibPay by the API. */
export async function getPayment(ref: string): Promise<BillingResult<BillingPayment>> {
  return toResult(await call(`/billing/payments/${encodeURIComponent(ref)}`));
}

export async function startCheckout(input: CheckoutInput): Promise<BillingResult<CheckoutResult>> {
  return toResult(await call('/billing/checkout', input));
}

export async function saveDetails(input: ReceiptDetailsInput): Promise<BillingResult<unknown>> {
  if (!API_URL) return { kind: 'error' };
  try {
    const res = await fetch(`${API_URL}/billing/receipt-details`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return toResult({ status: res.status, body: await res.json().catch(() => null) });
  } catch {
    return { kind: 'error' };
  }
}

/** I13: public. The answer is the same whether or not the email has an account. */
export async function requestSignInLink(email: string): Promise<'sent' | 'invalid' | 'rate_limited' | 'error'> {
  const r = await call('/billing/sign-in-link', { email });
  if (r.status === 200) return 'sent';
  if (r.status === 400) return 'invalid';
  return r.status === 429 ? 'rate_limited' : 'error';
}

/** The receipt PDF as a file to save (sent with the session cookie). */
export async function downloadReceipt(ref: string): Promise<{ kind: 'ok'; file: Blob; filename: string } | { kind: 'signed_out' } | { kind: 'error' }> {
  if (!API_URL) return { kind: 'error' };
  try {
    const res = await fetch(`${API_URL}/billing/payments/${encodeURIComponent(ref)}/receipt.pdf`, { credentials: 'include' });
    if (res.status === 401) return { kind: 'signed_out' };
    if (!res.ok) return { kind: 'error' };
    const filename = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'receipt.pdf';
    return { kind: 'ok', file: await res.blob(), filename };
  } catch {
    return { kind: 'error' };
  }
}

/** Saves a downloaded file through the browser. */
export function saveFile(file: Blob, filename: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
