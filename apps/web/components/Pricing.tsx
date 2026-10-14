import Link from 'next/link';
import { EXTRA_RESOURCE_SEN, PAID_PLANS, PLAN_PRICES } from '@outletbooking/shared';
import { formatRm } from '@/lib/money';
import { s } from '@/strings/en';
import { TrialButton } from './TrialButton';

/** Prices come from the shared plan config (same numbers as the app's E3). */
export function Pricing() {
  return (
    <section id="pricing" className="section">
      <div className="wrap">
        <h2 className="section-title">{s.pricing.title}</h2>
        <div className="grid grid-2" style={{ maxWidth: 820 }}>
          {PAID_PLANS.map((plan) => (
            <div key={plan} className="card plan">
              <h3>{s.pricing.plans[plan].name}</h3>
              <div className="plan-price">
                {formatRm(PLAN_PRICES[plan].priceSen)} <small>{s.pricing.perMonth}</small>
              </div>
              <ul>
                <li>{s.pricing.upTo(PLAN_PRICES[plan].resourceLimit)}</li>
                {s.pricing.plans[plan].features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <TrialButton />
            </div>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 16 }}>
          {s.pricing.extra(formatRm(EXTRA_RESOURCE_SEN))} <Link href="/contact">{s.pricing.talk}</Link>.
        </p>
      </div>
    </section>
  );
}

/** "Starter RM 49 · Business RM 99 per month after the trial" */
export const afterTrialLine = () =>
  s.pricing.afterTrial(formatRm(PLAN_PRICES.starter.priceSen), formatRm(PLAN_PRICES.business.priceSen));
