'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import {
  adminReason,
  PAID_PLANS,
  PLAN_PAYMENT_FILTERS,
  PLAN_PRICES,
  type AdminBusinessRow,
  type PaidPlan,
  type PlanPaymentFilter,
  type PlanPaymentRow,
  type PlanPaymentRowStatus,
  type PlanPaymentsResponse,
} from '@outletbooking/shared';
import { exportPlanPayments, listBusinesses, listPlanPayments, recordBankTransfer } from '@/lib/admin-api';
import { formatDateTime } from '@/lib/admin-format';
import { formatRm, formatRmFull } from '@/lib/money';
import { s } from '@/strings/en';
import { useAdmin } from './AdminShell';

const t = s.admin;
const p = t.payments;
const r = p.record;

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; data: PlanPaymentsResponse; loadingMore: boolean }
  | { kind: 'error' };

const STATUS_TAG: Record<PlanPaymentRowStatus, string> = {
  paid: 'tag',
  refunded: 'tag tag-gray',
  not_completed: 'tag tag-red',
  waiting: 'tag tag-gray',
  to_check: 'tag tag-pend',
};

/** I8 · Plan payments: KPIs, filters, the list, CSV export and "Record a bank transfer". */
export function PaymentsAdmin() {
  const { signedOut } = useAdmin();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PlanPaymentFilter>('all');
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);

  // Search as you type, a moment after the last key.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    let live = true;
    void listPlanPayments(query, filter).then((res) => {
      if (!live) return;
      if (res.kind === 'ok') setState({ kind: 'ok', data: res.data, loadingMore: false });
      else if (res.kind === 'signed_out') signedOut();
      else setState({ kind: 'error' });
    });
    return () => {
      live = false;
    };
  }, [query, filter, attempt, signedOut]);

  async function loadMore() {
    if (state.kind !== 'ok' || state.data.nextBeforeId === null || state.loadingMore) return;
    const { data } = state;
    setState({ kind: 'ok', data, loadingMore: true });
    const res = await listPlanPayments(query, filter, data.nextBeforeId ?? undefined);
    if (res.kind === 'ok') {
      setState({
        kind: 'ok',
        loadingMore: false,
        data: { ...res.data, payments: [...data.payments, ...res.data.payments] },
      });
    } else if (res.kind === 'signed_out') signedOut();
    else setState({ kind: 'ok', data, loadingMore: false });
  }

  async function exportCsv() {
    setExporting(true);
    setExportFailed(false);
    const res = await exportPlanPayments(query, filter);
    setExporting(false);
    if (res.kind === 'signed_out') return signedOut();
    if (res.kind === 'error') return setExportFailed(true);
    const url = URL.createObjectURL(res.file);
    const link = document.createElement('a');
    link.href = url;
    link.download = res.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const data = state.kind === 'ok' ? state.data : null;
  const k = data?.kpis;
  const diff = k?.incomeVsLastMonthSen ?? 0;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>{p.title}</h1>
          <p className="muted">{p.subtitle}</p>
        </div>
        <div className="row-actions">
          <label className="fld admin-search">
            <span className="sr-only">{p.search}</span>
            <input
              className="inp"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={p.searchPlaceholder}
              aria-label={p.search}
            />
          </label>
          <button type="button" className="btn2" onClick={exportCsv} disabled={exporting}>
            {exporting ? p.exporting : p.export}
          </button>
        </div>
      </div>
      {exportFailed && (
        <p className="alert alert-error" role="alert">
          {p.exportError}
        </p>
      )}

      {k && (
        <div className="kpis kpis-4">
          <Kpi
            value={formatRm(k.incomeThisMonthSen)}
            label={p.kpis.income}
            note={diff === 0 ? p.kpis.incomeSame : p.kpis.incomeVs(formatRm(Math.abs(diff)), diff > 0)}
          />
          <Kpi value={k.notCompleted} label={p.kpis.notCompleted} />
          <Kpi value={k.toCheck} label={p.kpis.toCheck} />
          <Kpi value={k.renewSoon} label={p.kpis.renewSoon} />
        </div>
      )}

      <div className="chips" role="group" aria-label={p.title}>
        {PLAN_PAYMENT_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`chip${filter === f ? ' on' : ''}`}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {p.filters[f]}
          </button>
        ))}
      </div>

      {state.kind === 'loading' && <p className="muted">{t.loading}</p>}
      {state.kind === 'error' && (
        <div className="card admin-card">
          <p className="alert alert-error" role="alert">
            {t.loadError}
          </p>
          <button type="button" className="btn2" onClick={() => setAttempt((n) => n + 1)}>
            {t.retry}
          </button>
        </div>
      )}
      {data && data.payments.length === 0 && <p className="card admin-empty muted">{query.trim() ? p.empty : (p.none[filter] ?? p.empty)}</p>}
      {data && data.payments.length > 0 && (
        <div className="card table-card">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{p.cols.date}</th>
                <th>{p.cols.business}</th>
                <th className="num">{p.cols.amount}</th>
                <th>{p.cols.method}</th>
                <th>{p.cols.reference}</th>
                <th>{p.cols.status}</th>
                <th>
                  <span className="sr-only">{p.open}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data?.nextBeforeId != null && (
        <button type="button" className="btn2 admin-more" onClick={loadMore} disabled={state.kind === 'ok' && state.loadingMore}>
          {state.kind === 'ok' && state.loadingMore ? p.loadingMore : p.loadMore}
        </button>
      )}

      <RecordTransfer onRecorded={() => setAttempt((n) => n + 1)} />

      <p className="card admin-note small">{p.footnote}</p>
    </div>
  );
}

function Row({ row }: { row: PlanPaymentRow }) {
  return (
    <tr>
      <td className="nowrap">{formatDateTime(row.at)}</td>
      <td>
        <span className="row-title">{row.businessName}</span>
        {row.planName && <div className="muted small">{p.planLine(row.planName)}</div>}
      </td>
      <td className="num nowrap">{formatRmFull(row.amountSen)}</td>
      <td>
        <div>{(row.method && p.methods[row.method]) ?? p.unknownMethod}</div>
        {row.manual && <div className="muted small">{row.recordedBy ? p.manualBy(row.recordedBy) : p.manual}</div>}
      </td>
      <td className="nowrap">{row.providerRef ?? '—'}</td>
      <td>
        <span className={STATUS_TAG[row.status]}>{p.status[row.status]}</span>
        {row.receiptNo && <div className="muted small">{row.receiptNo}</div>}
      </td>
      <td className="actions-cell">
        {row.ref && (
          <Link className="btn2 btn-sm" href={`/admin/payments/${encodeURIComponent(row.ref)}`} aria-label={p.openFor(row.businessName)}>
            {p.open}
          </Link>
        )}
      </td>
    </tr>
  );
}

function Kpi({ value, label, note }: { value: number | string; label: string; note?: string }) {
  return (
    <div className="card kpi">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {note && <div className="kpi-note">{note}</div>}
    </div>
  );
}

const rmToSen = (text: string): number | null => {
  const clean = text.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
};

/** Pick a business, plan, amount, bank reference and reason → one paid month and a receipt. */
function RecordTransfer({ onRecorded }: { onRecorded: () => void }) {
  const { signedOut } = useAdmin();
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<AdminBusinessRow[] | null>(null);
  const [businessId, setBusinessId] = useState('');
  const [plan, setPlan] = useState<PaidPlan>('business');
  const [amount, setAmount] = useState((PLAN_PRICES.business.priceSen / 100).toFixed(2));
  const [amountEdited, setAmountEdited] = useState(false);
  const [bankRef, setBankRef] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Find businesses a moment after the last key.
  useEffect(() => {
    if (search.trim().length < 2) {
      setOptions(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void listBusinesses(search, 'all').then((res) => {
        if (!live) return;
        if (res.kind === 'ok') setOptions(res.data.businesses.slice(0, 20));
        else if (res.kind === 'signed_out') signedOut();
      });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search, signedOut]);

  function choosePlan(next: PaidPlan) {
    setPlan(next);
    // Follow the plan price until the admin types an amount of their own.
    if (!amountEdited) setAmount((PLAN_PRICES[next].priceSen / 100).toFixed(2));
  }

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setDone(null);
    const amountSen = rmToSen(amount);
    const reasonOk = adminReason.safeParse(reason);
    if (!businessId) return setError(r.errors.pickBusiness);
    if (amountSen === null || amountSen < 100) return setError(r.errors.amount);
    if (bankRef.trim().length < 3) return setError(r.errors.bankRef);
    if (!reasonOk.success) return setError(r.errors.reason);

    setBusy(true);
    setError(null);
    const res = await recordBankTransfer({
      businessId: Number(businessId),
      plan,
      amountSen,
      bankRef: bankRef.trim(),
      reason: reasonOk.data,
    });
    setBusy(false);
    if (res.kind === 'ok') {
      const { payment, receiptEmailed } = res.data;
      setDone((receiptEmailed ? r.done : r.doneNoEmail)(payment.receiptNo ?? '', payment.businessName));
      setBankRef('');
      setReason('');
      setBusinessId('');
      setSearch('');
      setOptions(null);
      setAmountEdited(false);
      setAmount((PLAN_PRICES[plan].priceSen / 100).toFixed(2));
      onRecorded();
    } else if (res.kind === 'signed_out') signedOut();
    else if (res.kind === 'duplicate') setError(r.errors.duplicate);
    else if (res.kind === 'refused' && res.message) setError(res.message);
    else setError(r.errors.generic);
  }

  return (
    <form className="card admin-card admin-card-wide record-form" method="post" onSubmit={submit} noValidate>
      <h2>{r.title}</h2>
      <p className="muted">{r.intro}</p>

      <label className="fld">
        <span className="lbl">{r.businessSearch}</span>
        <input
          className="inp"
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setBusinessId('');
          }}
          placeholder={r.businessPlaceholder}
        />
      </label>
      {options !== null && (
        <label className="fld">
          <span className="lbl">{r.business}</span>
          {options.length === 0 ? (
            <span className="muted">{r.noMatch}</span>
          ) : (
            <select className="inp" value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
              <option value="">{r.pick}</option>
              {options.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · {b.slug}
                </option>
              ))}
            </select>
          )}
        </label>
      )}

      <div className="record-grid">
        <label className="fld">
          <span className="lbl">{r.plan}</span>
          <select className="inp" value={plan} onChange={(e) => choosePlan(e.target.value as PaidPlan)}>
            {PAID_PLANS.map((code) => (
              <option key={code} value={code}>
                {t.plans[code]}
              </option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span className="lbl">{r.amount}</span>
          <input
            className="inp"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setAmountEdited(true);
            }}
          />
        </label>
        <label className="fld">
          <span className="lbl">{r.bankRef}</span>
          <input
            className="inp"
            value={bankRef}
            maxLength={60}
            onChange={(e) => setBankRef(e.target.value)}
            placeholder={r.bankRefPlaceholder}
          />
        </label>
      </div>
      <p className="muted small">{r.amountHint(formatRmFull(PLAN_PRICES[plan].priceSen))}</p>

      <label className="fld">
        <span className="lbl">{r.reason}</span>
        <textarea
          className="inp"
          rows={2}
          value={reason}
          maxLength={500}
          placeholder={r.reasonPlaceholder}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="alert alert-ok" role="status">
          {done}
        </p>
      )}
      <div>
        <button type="submit" className="btn" disabled={busy}>
          {busy ? r.submitting : r.submit}
        </button>
      </div>
      <p className="muted small">{r.note}</p>
    </form>
  );
}
