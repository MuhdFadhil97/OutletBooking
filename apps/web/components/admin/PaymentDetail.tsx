'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import {
  adminReason,
  PLAN_REFUND_REASONS,
  type PlanAfterRefund,
  type PlanPaymentDetail,
  type PlanRefundReason,
} from '@outletbooking/shared';
import { downloadPlanReceipt, getPlanPayment, recordPlanRefund, resendPlanReceipt } from '@/lib/admin-api';
import { formatDate, formatDateTime, ymdInMalaysia } from '@/lib/admin-format';
import { formatRmFull } from '@/lib/money';
import { s } from '@/strings/en';
import { useAdmin } from './AdminShell';
import { ReasonForm } from './ReasonForm';

const t = s.admin;
const p = t.payments;
const d = p.detail;
const f = d.form;
const DAY_MS = 86_400_000;

type State = { kind: 'loading' } | { kind: 'ok'; detail: PlanPaymentDetail } | { kind: 'not_found' } | { kind: 'error' };

const STATUS_TAG: Record<string, string> = {
  paid: 'tag',
  refunded: 'tag tag-gray',
  not_completed: 'tag tag-red',
  waiting: 'tag tag-gray',
  to_check: 'tag tag-pend',
};

/** "2 Nov – 1 Dec 2026": the period ends the day before `end`. */
const periodLabel = (start: string | null, end: string | null) =>
  start && end ? `${formatDate(start)} – ${formatDate(new Date(Date.parse(end) - DAY_MS).toISOString())}` : '';

const rmToSen = (text: string): number | null => {
  const clean = text.replace(/,/g, '').trim();
  return /^\d+(\.\d{1,2})?$/.test(clean) ? Math.round(Number(clean) * 100) : null;
};

/** I24 · Plan payment detail: double-payment warning, receipt, refunds, "Record a refund". */
export function PaymentDetail({ paymentRef }: { paymentRef: string }) {
  const { signedOut } = useAdmin();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [downloadFailed, setDownloadFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void getPlanPayment(paymentRef).then((res) => {
      if (!live) return;
      if (res.kind === 'ok') setState({ kind: 'ok', detail: res.data });
      else if (res.kind === 'signed_out') signedOut();
      else if (res.kind === 'not_found') setState({ kind: 'not_found' });
      else setState({ kind: 'error' });
    });
    return () => {
      live = false;
    };
  }, [paymentRef, attempt, signedOut]);

  async function download() {
    setDownloadFailed(false);
    const res = await downloadPlanReceipt(paymentRef);
    if (res.kind === 'signed_out') return signedOut();
    if (res.kind === 'error') return setDownloadFailed(true);
    const url = URL.createObjectURL(res.file);
    const link = document.createElement('a');
    link.href = url;
    link.download = res.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const back = (
    <Link className="back-link" href="/admin/payments">
      ← {d.back}
    </Link>
  );

  if (state.kind === 'loading') return <div className="admin-page">{back}<p className="muted">{t.loading}</p></div>;
  if (state.kind === 'not_found') {
    return (
      <div className="admin-page">
        {back}
        <p className="card admin-empty muted">{d.notFound}</p>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="admin-page">
        {back}
        <div className="card admin-card">
          <p className="alert alert-error" role="alert">
            {t.loadError}
          </p>
          <button type="button" className="btn2" onClick={() => setAttempt((n) => n + 1)}>
            {t.retry}
          </button>
        </div>
      </div>
    );
  }

  const { detail } = state;
  const row = detail.payment;
  const period = periodLabel(detail.periodStart, detail.periodEnd);
  const canResend = row.status === 'paid' && !!detail.receiptEmail && !!row.receiptNo;
  const statusText = row.status === 'paid' && row.manual ? d.statusLine.paidManual : (d.statusLine[row.status] ?? row.status);
  const sub = detail.subscription;

  return (
    <div className="admin-page">
      {back}
      <div className="admin-page-head">
        <div>
          <h1>{d.title}</h1>
          <p className="muted">{row.businessName}</p>
        </div>
      </div>

      {detail.possibleDouble.length > 0 && (
        <div className="alert alert-warn" role="alert">
          <strong>{d.doubleTitle}</strong>{' '}
          {detail.possibleDouble.map((o) => (
            <span key={o.ref}>
              {d.doubleBody(row.receiptNo ?? row.ref, o.receiptNo ?? o.ref, 60)}{' '}
              <Link href={`/admin/payments/${encodeURIComponent(o.ref)}`}>{o.receiptNo ?? o.ref}</Link>
            </span>
          ))}
        </div>
      )}
      {flash && (
        <p className="alert alert-ok" role="status">
          {flash}
        </p>
      )}

      <section className="card admin-card admin-card-wide">
        <h2>{d.payment(row.receiptNo ?? row.ref)}</h2>
        <dl className="detail-list">
          <dt>{d.fields.business}</dt>
          <dd>
            <Link href={`/admin/businesses/${row.businessId}`}>{row.businessName}</Link>
          </dd>
          <dt>{d.fields.plan}</dt>
          <dd>{d.planPeriod(row.planName ?? '—', period)}</dd>
          <dt>{d.fields.amount}</dt>
          <dd>{formatRmFull(row.amountSen)}</dd>
          <dt>{d.fields.method}</dt>
          <dd>
            {(row.method && p.methods[row.method]) ?? p.unknownMethod}
            {row.manual && ` · ${row.recordedBy ? p.manualBy(row.recordedBy) : p.manual}`}
          </dd>
          <dt>{row.manual ? d.fields.bankRef : d.fields.bill}</dt>
          <dd>{row.providerRef ?? '—'}</dd>
          <dt>{d.fields.status}</dt>
          <dd>
            <span className={STATUS_TAG[row.status] ?? 'tag'}>{p.status[row.status]}</span> <span className="muted small">{statusText}</span>
          </dd>
          <dt>{d.timeline.paid}</dt>
          <dd>{detail.paidAt ? formatDateTime(detail.paidAt) : '—'}</dd>
          <dt>{d.timeline.created}</dt>
          <dd>{formatDateTime(detail.createdAt)}</dd>
          {sub && (
            <>
              <dt>{d.fields.planToday}</dt>
              <dd>
                {d.planToday(t.plans[sub.plan] ?? sub.plan, d.subStatus[sub.status] ?? sub.status, sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : null)}
              </dd>
            </>
          )}
        </dl>

        {row.receiptNo && (
          <div className="row-actions">
            <button type="button" className="btn2" onClick={download}>
              {d.download}
            </button>
          </div>
        )}
        {downloadFailed && (
          <p className="alert alert-error" role="alert">
            {d.downloadError}
          </p>
        )}
        {canResend && (
          <details className="resend">
            <summary className="btn2 btn-sm">{d.resend}</summary>
            <ReasonForm
              label={d.resendLabel}
              submit={d.resendSubmit}
              onSubmit={async (reason) => {
                const res = await resendPlanReceipt(paymentRef, reason);
                if (res.kind === 'ok') {
                  setFlash(d.resendDone(res.data.sentTo));
                  return null;
                }
                if (res.kind === 'signed_out') {
                  signedOut();
                  return null;
                }
                return res.kind === 'refused' ? res.message : t.loadError;
              }}
            />
          </details>
        )}
      </section>

      {detail.refunds.length > 0 && (
        <section className="card admin-card admin-card-wide">
          <h2>{d.refundsTitle}</h2>
          <ul className="plain-list">
            {detail.refunds.map((x) => (
              <li key={x.id}>
                <strong>{formatRmFull(x.amountSen)}</strong> · {x.reasonCode ? f.reasons[x.reasonCode] : f.reasons.other}
                <div className="muted small">
                  {d.refundLine(formatRmFull(x.amountSen), x.paidOn ? formatDate(`${x.paidOn}T12:00:00+08:00`) : formatDate(x.createdAt), x.recordedBy)}
                  {x.bankRef && ` · ${x.bankRef}`}
                </div>
              </li>
            ))}
          </ul>
          <p className="muted small">{d.refundedTotal(formatRmFull(detail.refundedSen), formatRmFull(detail.refundableSen))}</p>
        </section>
      )}

      {detail.refundableSen > 0 ? (
        <RefundForm
          paymentRef={paymentRef}
          detail={detail}
          onRecorded={(message, next) => {
            setFlash(message);
            setState({ kind: 'ok', detail: next });
          }}
        />
      ) : (
        <p className="card admin-note small">{row.status === 'refunded' ? f.nothingLeft : f.notPaid}</p>
      )}
    </div>
  );
}

function RefundForm({
  paymentRef,
  detail,
  onRecorded,
}: {
  paymentRef: string;
  detail: PlanPaymentDetail;
  onRecorded: (message: string, next: PlanPaymentDetail) => void;
}) {
  const { signedOut } = useAdmin();
  const max = detail.refundableSen;
  const [reasonCode, setReasonCode] = useState<PlanRefundReason>(detail.possibleDouble.length > 0 ? 'charged_twice' : 'other');
  const [mode, setMode] = useState<'full' | 'part'>('full');
  const [amount, setAmount] = useState('');
  const [bankRef, setBankRef] = useState('');
  const [paidOn, setPaidOn] = useState(ymdInMalaysia(new Date()));
  const [reason, setReason] = useState('');
  const [planAfter, setPlanAfter] = useState<PlanAfterRefund>(detail.possibleDouble.length > 0 ? 'keep' : 'end_now');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const amountSen = mode === 'full' ? max : rmToSen(amount);
    const reasonOk = adminReason.safeParse(reason);
    if (amountSen === null || amountSen < 100) return setError(f.errors.amount);
    if (amountSen > max) return setError(f.errors.tooMuch(formatRmFull(max)));
    if (bankRef.trim().length < 3) return setError(f.errors.bankRef);
    if (!paidOn) return setError(f.errors.paidOn);
    if (!reasonOk.success) return setError(f.errors.reason);

    setBusy(true);
    setError(null);
    const res = await recordPlanRefund(paymentRef, { amountSen, reasonCode, bankRef: bankRef.trim(), paidOn, planAfter, reason: reasonOk.data });
    setBusy(false);
    if (res.kind === 'ok') {
      const money = formatRmFull(amountSen);
      onRecorded((res.data.refundEmailed ? f.done : f.doneNoEmail)(money), res.data.detail);
    } else if (res.kind === 'signed_out') signedOut();
    else if (res.kind === 'refused' && res.message) setError(res.message);
    else setError(f.errors.generic);
  }

  return (
    <form className="card admin-card admin-card-wide record-form" method="post" onSubmit={submit} noValidate>
      <h2>{f.title}</h2>

      <label className="fld">
        <span className="lbl">{f.reasonCode}</span>
        <select className="inp" value={reasonCode} onChange={(e) => setReasonCode(e.target.value as PlanRefundReason)}>
          {PLAN_REFUND_REASONS.map((code) => (
            <option key={code} value={code}>
              {f.reasons[code]}
            </option>
          ))}
        </select>
      </label>

      <div className="chips" role="radiogroup" aria-label={f.amount}>
        <button type="button" role="radio" aria-checked={mode === 'full'} className={`chip${mode === 'full' ? ' on' : ''}`} onClick={() => setMode('full')}>
          {f.full(formatRmFull(max))}
        </button>
        <button type="button" role="radio" aria-checked={mode === 'part'} className={`chip${mode === 'part' ? ' on' : ''}`} onClick={() => setMode('part')}>
          {f.part}
        </button>
      </div>
      {mode === 'part' && (
        <label className="fld">
          <span className="lbl">{f.amount}</span>
          <input className="inp" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
      )}

      <div className="record-grid">
        <label className="fld">
          <span className="lbl">{f.bankRef}</span>
          <input className="inp" value={bankRef} maxLength={60} onChange={(e) => setBankRef(e.target.value)} />
        </label>
        <label className="fld">
          <span className="lbl">{f.paidOn}</span>
          <input className="inp" type="date" value={paidOn} max={ymdInMalaysia(new Date())} onChange={(e) => setPaidOn(e.target.value)} />
        </label>
      </div>

      <label className="fld">
        <span className="lbl">{f.reason}</span>
        <textarea className="inp" rows={2} value={reason} maxLength={500} placeholder={f.reasonPlaceholder} onChange={(e) => setReason(e.target.value)} />
      </label>

      <fieldset className="fld-stack">
        <legend className="lbl">{f.planAfter}</legend>
        <label>
          <input type="radio" name="planAfter" checked={planAfter === 'keep'} onChange={() => setPlanAfter('keep')} /> {f.keep}
        </label>
        <label>
          <input type="radio" name="planAfter" checked={planAfter === 'end_now'} onChange={() => setPlanAfter('end_now')} /> {f.endNow}
        </label>
      </fieldset>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <div>
        <button type="submit" className="btn" disabled={busy}>
          {busy ? f.submitting : f.submit}
        </button>
      </div>
      <p className="muted small">{f.note}</p>
    </form>
  );
}
