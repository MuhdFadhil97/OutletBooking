import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';

export const metadata: Metadata = { title: 'Notis Privasi — OutletBooking' };

/** I18 · Notis Privasi (PDPA s.7(3): Bahasa Melayu version) */
export default function PrivacyMsPage() {
  return <LegalPage doc="privacy" lang="ms" />;
}
