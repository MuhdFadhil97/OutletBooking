import type { Metadata } from 'next';
import { BillingPay } from '@/components/billing/BillingPay';
import { s } from '@/strings/en';

export const metadata: Metadata = { title: s.billing.pay.metaTitle, robots: { index: false, follow: false } };

/** I4 · Pay for a plan (signed in by the emailed link; the app opens it already signed in) */
export default function BillingPage() {
  return <BillingPay />;
}
