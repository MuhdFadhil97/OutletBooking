'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { PAID_PLANS, PLAN_FEATURES, type BillingOverview, type PaidPlan } from '@outletbooking/shared';
import { getOverview, startCheckout } from '@/lib/billing-api';
import { formatDate } from '@/lib/admin-format';
import { links } from '@/lib/config';
import { formatRm, formatRmFull } from '@/lib/money';
import { s } from '@/strings/en';
import { BillingBar, BillingMessage } from './BillingBar';
import { checkDetails, DetailsFields, toForm, toInput, type DetailsErrors, type DetailsForm } from './DetailsFields';
import { useBillingData } from './useBillingData';

const t = s.billing;
const p = t.pay;

/** I4 · Pay for a plan: choose a plan, receipt details, summary, then ToyyibPay (FPX / DuitNow). */
export function BillingPay() {
  const { state, reload } = useBillingData(getOverview);
  if (state.kind !== 'ok') {
    return (
      <div className="wrap billing-wrap">
        <BillingMessage
          kind={state.kind === 'loading' ? 'loading' : state.kind === 'refused' ? 'refused' : state.kind === 'not_found' ? 'not_found' : 'error'}
          message={state.kind === 'refused' ? state.message : undefined}
          onRetry={reload}
        />
      </div>
    );
  }
  return <PayForm overview={state.data} />;
}

function subtitle(o: BillingOverview): string {
  const sub = o.subscription;
  const name = o.business.name;
  const plan = sub.plan === 'trial' ? '' : (o.plans.find((x) => x.code === sub.plan)?.name ?? sub.plan);
  if (sub.freeUntil && Date.parse(sub.freeUntil) > Date.now() && sub.plan !== 'trial') return p.freeUntil(name, plan, formatDate(sub.freeUntil));
  if (sub.status === 'active' && sub.currentPeriodEnd && Date.parse(sub.currentPeriodEnd) > Date.now()) {
    return p.paidUntil(name, plan, formatDate(sub.currentPeriodEnd));
  }
  return sub.hasAccess ? p.trialEnds(name, formatDate(sub.trialEndsAt)) : p.trialEnded(name, formatDate(sub.trialEndsAt));
}

function startsText(o: BillingOverview): string {
  const sub = o.subscription;
  if (sub.status === 'trialing' && sub.hasAccess) return p.startsTrial(formatDate(sub.trialEndsAt));
  if (sub.status !== 'trialing' && sub.currentPeriodEnd && Date.parse(sub.currentPeriodEnd) > Date.now()) {
    return p.startsAfter(formatDate(sub.currentPeriodEnd));
  }
  return p.startsToday;
}

function PayForm({ overview: o }: { overview: BillingOverview }) {
  const current = o.subscription.plan === 'trial' ? null : o.subscription.plan;
  const [plan, setPlan] = useState<PaidPlan>(current ?? o.recommended);
  const [details, setDetails] = useState<DetailsForm>(toForm(o.details));
  const [errors, setErrors] = useState<DetailsErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "?plan=business" (from the app's Choose a plan) preselects that plan.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('plan');
    const match = PAID_PLANS.find((x) => x === wanted);
    if (match && o.plans.some((x) => x.code === match)) setPlan(match);
  }, [o.plans]);

  const quote = o.quotes[plan];
  const chosen = useMemo(() => o.plans.find((x) => x.code === plan) ?? o.plans[0], [o.plans, plan]);
  const label = o.resourceLabel;

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const found = checkDetails(details);
    setErrors(found);
    setError(null);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const r = await startCheckout({ plan, details: toInput(details) });
    if (r.kind === 'ok') {
      window.location.href = r.data.paymentUrl; // ToyyibPay: FPX / DuitNow
      return;
    }
    setBusy(false);
    setError(r.kind === 'refused' ? r.message : p.errors.generic);
  }

  return (
    <div className="wrap billing-wrap">
      <BillingBar email={o.signedInAs} />
      <h1>{p.title}</h1>
      <p className="muted">{subtitle(o)}</p>

      {/* method="post": a submit before JS loads must never put anything in the URL. */}
      <form method="post" className="pay-grid" onSubmit={submit} noValidate>
        <div className="pay-main">
          <div className="plan-picks" role="radiogroup" aria-label={p.title}>
            {o.plans.map((x) => (
              <label key={x.code} className={`card plan-pick${plan === x.code ? ' on' : ''}`}>
                <input type="radio" name="plan" value={x.code} checked={plan === x.code} onChange={() => setPlan(x.code)} />
                <span className="plan-pick-head">
                  <strong>{x.name}</strong>
                  {x.code === current ? (
                    <span className="tag">{p.current}</span>
                  ) : (
                    x.code === o.recommended && <span className="tag tag-blue">{p.best}</span>
                  )}
                </span>
                <span className="muted small">{p.upTo(x.resourceLimit, label, o.resourceCount)}</span>
                <span className="muted small">
                  {PLAN_FEATURES.filter((f) => x.features[f])
                    .map((f) => p.features[f])
                    .join(' · ')}
                </span>
                <span className="plan-pick-price">
                  {formatRm(x.priceSen)} <small>{p.perMonth}</small>
                </span>
              </label>
            ))}
          </div>

          <section className="card billing-card">
            <h2>{p.detailsTitle}</h2>
            <DetailsFields value={details} errors={errors} onChange={setDetails} />
          </section>
        </div>

        <aside className="card billing-card pay-summary" aria-label={p.summary}>
          <h2>{p.summary}</h2>
          <dl className="summary-lines">
            <div>
              <dt>{p.line(chosen?.name ?? '')}</dt>
              <dd>{formatRmFull(quote.baseSen)}</dd>
            </div>
            <div>
              <dt>{p.extra(quote.extraResources, label)}</dt>
              <dd>{formatRmFull(quote.extraSen)}</dd>
            </div>
            <div className="summary-total">
              <dt>{p.total}</dt>
              <dd>{formatRmFull(quote.totalSen)}</dd>
            </div>
          </dl>
          <p className="muted small">{startsText(o)}</p>
          <p className="muted small">{p.renewal}</p>
          {error && (
            <p className="alert alert-error" role="alert">
              {error}
            </p>
          )}
          {!o.onlinePaymentAvailable && (
            <p className="alert alert-warn" role="status">
              {p.notConfigured}{' '}
              <a href={links.whatsapp(`Hi FTech, I'd like to pay for the ${chosen?.name ?? ''} plan for ${o.business.name}.`)} target="_blank" rel="noopener noreferrer">
                {t.whatsapp}
              </a>
            </p>
          )}
          <button type="submit" className="btn" disabled={busy || !o.onlinePaymentAvailable}>
            {busy ? p.paying : p.pay(formatRmFull(quote.totalSen))}
          </button>
          <p className="muted small">
            {p.secure} <Link href="/terms">{p.terms}</Link> {p.and} <Link href="/refund">{p.refund}</Link>.
          </p>
        </aside>
      </form>
    </div>
  );
}
