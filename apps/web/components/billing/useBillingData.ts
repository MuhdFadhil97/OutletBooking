'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { BillingResult } from '@/lib/billing-api';

export type BillingState<T> =
  | { kind: 'loading' }
  | { kind: 'ok'; data: T }
  | { kind: 'refused'; message: string }
  | { kind: 'not_found' }
  | { kind: 'error' };

/**
 * Loads one billing call. No session sends the visitor to the sign-in page (I13); a refusal (for example a
 * staff member who is not the owner) is shown as a message; anything else is a retryable error.
 */
export function useBillingData<T>(load: () => Promise<BillingResult<T>>): { state: BillingState<T>; reload: () => void } {
  const router = useRouter();
  const [state, setState] = useState<BillingState<T>>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void load().then((r) => {
      if (!live) return;
      if (r.kind === 'ok') setState({ kind: 'ok', data: r.data });
      else if (r.kind === 'signed_out') router.replace('/billing/sign-in');
      else if (r.kind === 'refused') setState({ kind: 'refused', message: r.message });
      else if (r.kind === 'not_found') setState({ kind: 'not_found' });
      else setState({ kind: 'error' });
    });
    return () => {
      live = false;
    };
    // `load` is a fresh function each render; the data is reloaded only on mount and on reload().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, router]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}
