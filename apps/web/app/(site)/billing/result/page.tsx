import type { Metadata } from 'next';
import { BillingResult } from '@/components/billing/BillingResult';
import { s } from '@/strings/en';

export const metadata: Metadata = { title: s.billing.result.metaTitle, robots: { index: false, follow: false } };

/** I15 · Payment received · I16 · Payment not completed (ToyyibPay returns here with ?billcode=…) */
export default function BillingResultPage() {
  return <BillingResult />;
}
