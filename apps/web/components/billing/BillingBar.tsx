'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/admin-auth';
import { s } from '@/strings/en';

const b = s.billing;

/** "Signed in as … · Billing & receipts · Sign out" above every signed-in billing page. */
export function BillingBar({ email }: { email: string }) {
  const router = useRouter();
  return (
    <div className="billing-bar">
      <span className="muted small">
        {b.signedInAs} <strong>{email}</strong>
      </span>
      <span className="billing-bar-links">
        <Link href="/billing/account">{b.billingLink}</Link>
        <button
          type="button"
          className="link-button"
          onClick={async () => {
            await signOut();
            router.replace('/billing/sign-in');
          }}
        >
          {b.signOut}
        </button>
      </span>
    </div>
  );
}

/** Loading, refused and error states shared by the billing pages. */
export function BillingMessage({ kind, message, onRetry }: { kind: 'loading' | 'refused' | 'error' | 'not_found'; message?: string; onRetry?: () => void }) {
  if (kind === 'loading') return <p className="muted">{b.loading}</p>;
  return (
    <div className="card billing-card">
      <p className="alert alert-error" role="alert">
        {kind === 'refused' ? (message ?? b.ownerOnly) : kind === 'not_found' ? b.result.notFound : b.loadError}
      </p>
      {kind === 'error' && onRetry && (
        <button type="button" className="btn2" onClick={onRetry}>
          {b.retry}
        </button>
      )}
    </div>
  );
}
