import { PRIVACY_NOTICE, PRIVACY_NOTICE_MS } from '@outletbooking/shared';
import { LegalPage } from '@/components/LegalPage';

/** Privacy notice (PDPA) in English and Bahasa Melayu — public, linked from sign-up, accept invite, the booking page and My account. */
export default function PrivacyScreen() {
  return (
    <LegalPage
      versions={[
        { label: 'English', doc: PRIVACY_NOTICE },
        { label: 'Bahasa Melayu', doc: PRIVACY_NOTICE_MS },
      ]}
    />
  );
}
