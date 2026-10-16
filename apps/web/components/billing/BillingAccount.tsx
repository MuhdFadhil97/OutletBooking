'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { planEntryMonthlySen, type BillingHistory } from '@outletbooking/shared';
import { formatDate } from '@/lib/admin-format';
import { downloadReceipt, getHistory, saveDetails, saveFile } from '@/lib/billing-api';
import { links } from '@/lib/config';
import { formatRm, formatRmFull } from '@/lib/money';
import { s } from '@/strings/en';
import { BillingBar, BillingMessage } from './BillingBar';
import { checkDetails, DetailsFields, toForm, toInput, type DetailsErrors, type DetailsForm } from './DetailsFields';
import { useBillingData } from './useBillingData';

const t = s.billing;
const a = t.account;

/** I17 · Billing & receipts: current plan, receipt details, and the payment history with PDF receipts. */
export function BillingAccount() {
  const { state, reload } = useBillingData(getHistory);
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
  return <Account history={state.data} />;
}

function Account({ history: h }: { history: BillingHistory }) {
  const sub = h.subscription;
  const plan = sub.plan === 'trial' ? null : (h.plans.find((x) => x.code === sub.plan) ?? null);
  const paidEnd = sub.currentPeriodEnd && Date.parse(sub.currentPeriodEnd) > Date.now() ? sub.currentPeriodEnd : null;
  const free = sub.freeUntil && Date.parse(sub.freeUntil) > Date.now() ? sub.freeUntil : null;

  return (
    <div className="wrap billing-wrap">
      <BillingBar email={h.signedInAs} />
      <h1>{a.title}</h1>
      <p className="muted">{h.businessName}</p>

      <section className="card billing-card" aria-labelledby="acct-plan">
        <h2 id="acct-plan">{plan ? `${plan.name} plan` : a.trialPlan}</h2>
        <p>
          <span className="tag">{a.status[sub.status] ?? sub.status}</span>{' '}
          {plan && (
            <strong>
              {formatRm(planEntryMonthlySen(plan, h.resourceCount))}{' '}
              <span className="muted">{a.perMonthUsed(h.resourceCount, plan.resourceLimit, h.resourceLabel)}</span>
            </strong>
          )}
        </p>
        <dl className="receipt-facts">
          {plan && paidEnd ? (
            <>
              <dt>{free ? a.freeUntil : a.paidUntil}</dt>
              <dd>{formatDate(paidEnd)}</dd>
            </>
          ) : (
            <>
              <dt>{a.trialEnds}</dt>
              <dd>{formatDate(sub.trialEndsAt)}</dd>
            </>
          )}
          <dt>{a.renewal}</dt>
          <dd>{a.renewalText}</dd>
        </dl>
        <div className="actions">
          <Link className="btn" href={plan ? `/billing?plan=${plan.code}` : '/billing'}>
            {plan ? a.payNext : a.pay}
          </Link>
          {plan && (
            <Link className="btn2" href="/billing">
              {a.changePlan}
            </Link>
          )}
        </div>
      </section>

      <DetailsCard history={h} />
      <History history={h} />

      <p className="muted small">
        {a.questions} <Link href="/contact?reason=account_help">{a.contact}</Link>. {a.see} <Link href="/refund">{t.pay.refund.toLowerCase()}</Link>.{' '}
        <a href={links.whatsapp()} target="_blank" rel="noopener noreferrer">
          {t.whatsapp}
        </a>
      </p>
    </div>
  );
}

function DetailsCard({ history: h }: { history: BillingHistory }) {
  const [form, setForm] = useState<DetailsForm>(toForm(h.details));
  const [errors, setErrors] = useState<DetailsErrors>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const found = checkDetails(form);
    setErrors(found);
    setNote(null);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const r = await saveDetails(toInput(form));
    setBusy(false);
    setNote(r.kind === 'ok' ? { ok: true, text: a.saved } : { ok: false, text: r.kind === 'refused' ? r.message : t.loadError });
  }

  return (
    <form method="post" className="card billing-card" onSubmit={submit} noValidate aria-labelledby="acct-details">
      <h2 id="acct-details">{a.detailsTitle}</h2>
      <DetailsFields value={form} errors={errors} onChange={setForm} />
      {note && (
        <p className={`alert ${note.ok ? 'alert-ok' : 'alert-error'}`} role={note.ok ? 'status' : 'alert'}>
          {note.text}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="btn" disabled={busy}>
          {busy ? a.saving : a.save}
        </button>
        <span className="muted small">{a.detailsNote}</span>
      </div>
    </form>
  );
}

function History({ history: h }: { history: BillingHistory }) {
  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [busyRef]);

  async function pdf(ref: string) {
    setBusyRef(ref);
    const res = await downloadReceipt(ref);
    setBusyRef(null);
    if (res.kind === 'ok') saveFile(res.file, res.filename);
    else setFailed(true);
  }

  const empty = h.payments.length === 0 && !h.trial;
  return (
    <section className="card table-card" aria-labelledby="acct-history">
      <h2 id="acct-history" className="table-title">
        {a.historyTitle}
      </h2>
      {empty ? (
        <p className="muted billing-empty">{a.empty}</p>
      ) : (
        <table className="hist-table">
          <thead>
            <tr>
              <th>{a.cols.date}</th>
              <th>{a.cols.description}</th>
              <th className="num">{a.cols.amount}</th>
              <th>{a.cols.method}</th>
              <th>{a.cols.receipt}</th>
            </tr>
          </thead>
          <tbody>
            {h.payments.map((p) => (
              <tr key={p.ref}>
                <td>{p.paidAt ? formatDate(p.paidAt) : ''}</td>
                <td>{p.description}</td>
                <td className="num">{formatRmFull(p.amountSen)}</td>
                <td>{(p.method && t.result.methodNames[p.method]) ?? p.method ?? '—'}</td>
                <td>
                  {p.receiptNo}{' '}
                  <button type="button" className="link-button" disabled={busyRef === p.ref} onClick={() => void pdf(p.ref)} aria-label={`${a.pdf} ${p.receiptNo ?? ''}`}>
                    {a.pdf}
                  </button>
                </td>
              </tr>
            ))}
            {h.trial && (
              <tr>
                <td>{formatDate(h.trial.start)}</td>
                <td>{a.freeTrialRow(formatDate(h.trial.start).replace(/ \d{4}$/, ''), formatDate(h.trial.end))}</td>
                <td className="num">{formatRmFull(0)}</td>
                <td>—</td>
                <td className="muted">{a.noReceipt}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {failed && (
        <p className="alert alert-error" role="alert">
          {t.result.downloadError}
        </p>
      )}
    </section>
  );
}
