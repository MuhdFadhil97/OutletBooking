import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { s } from '@/strings/en';

export const metadata: Metadata = { title: `${s.legal.tabs.refund} — OutletBooking` };

/** I18 · Refund policy (plan fees) */
export default function RefundPage() {
  return <LegalPage doc="refund" />;
}
