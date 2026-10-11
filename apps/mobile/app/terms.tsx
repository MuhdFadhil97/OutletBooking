import { TERMS } from '@outletbooking/shared';
import { LegalPage } from '@/components/LegalPage';

/** Terms of use — public, linked from sign-up, accept invite and My account. */
export default function TermsScreen() {
  return <LegalPage doc={TERMS} />;
}
