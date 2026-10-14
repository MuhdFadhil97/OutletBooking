import type { LeadCreateInput } from '@outletbooking/shared';
import { API_URL } from './config';

export type SubmitResult = 'ok' | 'rate_limited' | 'error';

/** I19 → POST /public/leads (no login). Sent from the browser so the API rate-limits per visitor. */
export async function submitLead(input: LeadCreateInput): Promise<SubmitResult> {
  if (!API_URL) return 'error';
  try {
    const res = await fetch(`${API_URL}/public/leads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (res.ok) return 'ok';
    return res.status === 429 ? 'rate_limited' : 'error';
  } catch {
    return 'error';
  }
}
