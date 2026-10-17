import { REFUND_POLICY } from '@outletbooking/shared';
import { LegalPage } from '@/components/LegalPage';

/** Refund policy for plan fees (what businesses pay FTech) — public, linked from My account and Plan & billing. */
export default function RefundScreen() {
  return <LegalPage versions={[{ label: 'English', doc: REFUND_POLICY }]} />;
}
