'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { BillingOverview, BillingPayment } from '@outletbooking/shared';
import { formatDate } from '@/lib/admin-format';
import { downloadReceipt, getOverview, getPayment, saveFile } from '@/lib/billing-api';
import { formatPaidAt, periodOf } from '@/lib/billing-format';
import { links } from '@/lib/config';
import { formatRmFull } from '@/lib/money';
import { s } from '@/strings/en';
import { BillingBar, BillingMessage } from './BillingBar';
import { useBillingData } from './useBillingData';

const t = s.billing;
const r = t.result;
/** After ToyyibPay sends the customer back, the confirmation can take a moment: look a few times. */
const POLL_MS = 3000;
const POLL_TIMES = 10;

/** I15 payment received · I16 payment not completed. ToyyibPay returns here with ?billcode=… */
export function BillingResult() {
  const [ref, setRef] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRef(params.get('billcode') || params.get('ref'));
  }, []);

  if (ref === undefined) return <div className="wrap billing-wrap"><p className="muted">{t.loading}</p></div>;
  if (ref === null) return <div className="wrap billing-wrap"><BillingMessage kind="not_found" /></div>;
  return <ResultFor refCode={ref} />;
}

function ResultFor({ refCode }: { refCode: string }) {
  const overview = useBillingData(getOverview);
  const [payment, setPayment] = useState<BillingPayment | null>(null);
  const [gone, setGone] = useState(false);
  const [checks, setChecks] = useState(0);
  const [tick, setTick] = useState(0);

  const check = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    let live = true;
    void getPayment(refCode).then((res) => {
      if (!live) return;
      if (res.kind === 'ok') {
        setPayment(res.data);
        setChecks((n) => n + 1);
      } else if (res.kind === 'not_found') setGone(true);
    });
    return () => {
      live = false;
    };
  }, [refCode, tick]);

  // Still pending: look again a few times.
  useEffect(() => {
    if (payment?.status !== 'pending' || checks >= POLL_TIMES) return;
    const timer = setTimeout(check, POLL_MS);
    return () => clearTimeout(timer);
  }, [payment, checks, check]);

  const o = overview.state.kind === 'ok' ? overview.state.data : null;
  if (overview.state.kind !== 'ok' && overview.state.kind !== 'loading') {
    return (
      <div className="wrap billing-wrap">
        <BillingMessage
          kind={overview.state.kind === 'refused' ? 'refused' : overview.state.kind === 'not_found' ? 'not_found' : 'error'}
          message={overview.state.kind === 'refused' ? overview.state.message : undefined}
          onRetry={overview.reload}
        />
      </div>
    );
  }
  return (
    <div className="wrap billing-wrap">
      {o && <BillingBar email={o.signedInAs} />}
      {gone && <BillingMessage kind="not_found" />}
      {!gone && !payment && <p className="muted">{r.checking}</p>}
      {payment?.status === 'paid' && o && <Paid payment={payment} overview={o} />}
      {payment?.status === 'pending' && <Pending checking={checks < POLL_TIMES} onCheck={() => { setChecks(0); check(); }} />}
      {payment && (payment.status === 'failed' || payment.status === 'expired') && o && <Failed payment={payment} overview={o} />}
    </div>
  );
}

function Paid({ payment, overview }: { payment: BillingPayment; overview: BillingOverview }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const planName = overview.plans.find((x) => x.code === payment.plan)?.name ?? '';
  const email = overview.details.receiptEmail;

  async function pdf() {
    setBusy(true);
    setError(false);
    const res = await downloadReceipt(payment.ref);
    setBusy(false);
    if (res.kind === 'ok') saveFile(res.file, res.filename);
    else setError(true);
  }

  return (
    <section className="card billing-card result-card" aria-labelledby="result-title">
      <h1 id="result-title">{r.successTitle}</h1>
      <p>{r.successText(overview.business.name, planName)}</p>
      <dl className="receipt-facts">
        <dt>{r.receiptNo}</dt>
        <dd>{payment.receiptNo}</dd>
        <dt>{r.paid}</dt>
        <dd>
          {formatRmFull(payment.amountSen)}
          {payment.paidAt && ` · ${formatPaidAt(payment.paidAt)}`}
        </dd>
        <dt>{r.method}</dt>
        <dd>{(payment.method && r.methodNames[payment.method]) ?? payment.method ?? '—'}</dd>
        {payment.transactionRef && (
          <>
            <dt>{r.ref}</dt>
            <dd>{payment.transactionRef}</dd>
          </>
        )}
        <dt>{r.period}</dt>
        <dd>{periodOf(payment.description)}</dd>
      </dl>
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void pdf()}>
          {busy ? r.downloading : r.download}
        </button>
        {links.login && (
          <a className="btn2" href={links.login}>
            {r.backToApp}
          </a>
        )}
      </div>
      {error && (
        <p className="alert alert-error" role="alert">
          {r.downloadError}
        </p>
      )}
      <p className="muted small">
        {r.emailed(email)} <Link href="/billing/account">{r.allReceipts}</Link>
      </p>
    </section>
  );
}

function Failed({ payment, overview }: { payment: BillingPayment; overview: BillingOverview }) {
  const planName = overview.plans.find((x) => x.code === payment.plan)?.name ?? '';
  const sub = overview.subscription;
  const retry = `/billing${payment.plan ? `?plan=${payment.plan}` : ''}`;
  return (
    <section className="card billing-card result-card" aria-labelledby="result-title">
      <h1 id="result-title">{r.failedTitle}</h1>
      <p>{r.failedText}</p>
      <dl className="receipt-facts">
        <dt>{r.plan}</dt>
        <dd>
          {planName} · {formatRmFull(payment.amountSen)}
        </dd>
        <dt>{r.ref}</dt>
        <dd>{payment.ref}</dd>
        {sub.status === 'trialing' && sub.hasAccess && (
          <>
            <dt>{r.freeTrial}</dt>
            <dd>{r.trialRunning(formatDate(sub.trialEndsAt))}</dd>
          </>
        )}
      </dl>
      <div className="actions">
        <Link className="btn" href={retry}>
          {r.tryAgain}
        </Link>
        <Link className="btn2" href="/billing">
          {r.otherBank}
        </Link>
      </div>
      <p className="muted small">
        {r.dontPayTwice} <Link href="/contact?reason=account_help">{r.contactUs}</Link>{' '}
        {r.orWhatsapp}
      </p>
    </section>
  );
}

function Pending({ checking, onCheck }: { checking: boolean; onCheck: () => void }) {
  return (
    <section className="card billing-card result-card" aria-live="polite">
      <h1>{r.pendingTitle}</h1>
      <p>{checking ? r.checking : r.pendingText}</p>
      {!checking && (
        <div className="actions">
          <button type="button" className="btn2" onClick={onCheck}>
            {r.checkAgain}
          </button>
        </div>
      )}
    </section>
  );
}
