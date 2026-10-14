import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { s } from '@/strings/en';

export const metadata: Metadata = { title: `${s.legal.tabs.privacy} — OutletBooking` };

/** I18 · Privacy notice (PDPA), English */
export default function PrivacyPage() {
  return <LegalPage doc="privacy" lang="en" />;
}
