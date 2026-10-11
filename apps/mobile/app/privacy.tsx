import { PRIVACY_NOTICE } from '@outletbooking/shared';
import { LegalPage } from '@/components/LegalPage';

/** Privacy notice (PDPA) — public, linked from sign-up, accept invite, the booking page and My account. */
export default function PrivacyScreen() {
  return <LegalPage doc={PRIVACY_NOTICE} />;
}
