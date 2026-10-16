import type { Metadata } from 'next';
import { BillingSignIn } from '@/components/billing/BillingSignIn';
import { s } from '@/strings/en';

export const metadata: Metadata = { title: s.billing.signIn.metaTitle, robots: { index: false, follow: false } };

/** I13 · Sign in by a one-time email link */
export default function BillingSignInPage() {
  return (
    <div className="wrap billing-wrap billing-narrow">
      <BillingSignIn />
    </div>
  );
}
