import Link from 'next/link';
import { PLAN_FEATURES, type PlanCatalogEntry } from '@outletbooking/shared';
import { getPublicPlans } from '@/lib/plans';
import { formatRm } from '@/lib/money';
import { s } from '@/strings/en';
import { TrialButton } from './TrialButton';

/** Prices, limits and features come from I12 (GET /plans), the same numbers as the app's E3. */
export async function Pricing() {
  const { plans } = await getPublicPlans();
  // One extra-resource price is shown; it is the same for every plan unless FTech changes one of them.
  const extra = plans[0]?.extraResourceSen ?? 0;
  return (
    <section id="pricing" className="section">
      <div className="wrap">
        <h2 className="section-title">{s.pricing.title}</h2>
        <div className="grid grid-2" style={{ maxWidth: 820 }}>
          {plans.map((plan) => (
            <div key={plan.code} className="card plan">
              <h3>{plan.name}</h3>
              <div className="plan-price">
                {formatRm(plan.priceSen)} <small>{s.pricing.perMonth}</small>
              </div>
              <ul>
                <li>{s.pricing.upTo(plan.resourceLimit)}</li>
                <li>{s.pricing.unlimited}</li>
                {PLAN_FEATURES.filter((f) => plan.features[f]).map((f) => (
                  <li key={f}>{s.pricing.features[f]}</li>
                ))}
              </ul>
              <TrialButton />
            </div>
          ))}
        </div>
        {extra > 0 && (
          <p className="muted" style={{ marginTop: 16 }}>
            {s.pricing.extra(formatRm(extra), Math.max(...plans.map((p: PlanCatalogEntry) => p.resourceLimit)))}{' '}
            <Link href="/contact">{s.pricing.talk}</Link>.
          </p>
        )}
      </div>
    </section>
  );
}

/** "Starter RM 49 · Business RM 99 per month after the trial" */
export async function afterTrialLine(): Promise<string> {
  const { plans } = await getPublicPlans();
  return s.pricing.afterTrial(plans.map((p) => `${p.name} ${formatRm(p.priceSen)}`).join(' · '));
}
