import type { BusinessTemplate, PaymentRule } from '@outletbooking/shared';
import { t } from '@/strings/en';

const r = t.setup.paymentRule;

/** Where "pay at …" happens for this business type ("venue", "shop", "centre"…). */
export const payPlace = (template: BusinessTemplate) => t.setup.place[template] ?? t.setup.place.other;

/** Choice label in "To confirm a booking, customers…". A deposit on free viewings is a booking fee. */
export function paymentRuleLabel(rule: PaymentRule, template: BusinessTemplate): string {
  if (rule === 'at_venue') return r.at_venue(payPlace(template));
  if (rule === 'deposit' && template === 'real_estate') return r.fee;
  return r[rule];
}

export function paymentRuleHint(rule: PaymentRule, template: BusinessTemplate): string {
  return rule === 'deposit' && template === 'real_estate' ? r.hint.fee : r.hint[rule];
}
