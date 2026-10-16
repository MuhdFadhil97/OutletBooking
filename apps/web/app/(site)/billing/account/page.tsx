import type { Metadata } from 'next';
import { BillingAccount } from '@/components/billing/BillingAccount';
import { s } from '@/strings/en';

export const metadata: Metadata = { title: s.billing.account.metaTitle, robots: { index: false, follow: false } };

/** I17 · Billing & receipts */
export default function BillingAccountPage() {
  return <BillingAccount />;
}
