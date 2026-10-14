import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { s } from '@/strings/en';

export const metadata: Metadata = { title: `${s.legal.tabs.terms} — OutletBooking` };

/** I18 · Terms of service */
export default function TermsPage() {
  return <LegalPage doc="terms" />;
}
