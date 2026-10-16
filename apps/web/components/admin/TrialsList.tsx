'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TRIAL_FILTERS, type TrialFilter, type TrialPaymentState, type TrialRow, type TrialsResponse } from '@outletbooking/shared';
import { listTrials } from '@/lib/admin-api';
import { daysUntil, formatDay, whatsappLink } from '@/lib/admin-format';
import { s } from '@/strings/en';
import { useAdmin } from './AdminShell';

const t = s.admin;
const tr = t.trials;

type State = { kind: 'loading' } | { kind: 'ok'; data: TrialsResponse } | { kind: 'error' };

const PAYMENT_TAG: Record<TrialPaymentState, string> = {
  connected: 'tag',
  not_yet: 'tag tag-pend',
  not_needed: 'tag tag-gray',
};

/** I7 · Trials ending: KPIs, search, chips, follow-up table with WhatsApp and Extend. */
export function TrialsList() {
  const { signedOut } = useAdmin();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TrialFilter>('week');
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // Search as you type, a moment after the last key.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    let live = true;
    void listTrials(query, filter).then((r) => {
      if (!live) return;
      if (r.kind === 'ok') setState({ kind: 'ok', data: r.data });
      else if (r.kind === 'signed_out') signedOut();
      else setState({ kind: 'error' });
    });
    return () => {
      live = false;
    };
  }, [query, filter, attempt, signedOut]);

  const data = state.kind === 'ok' ? state.data : null;
  const k = data?.kpis;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>{tr.title}</h1>
          <p className="muted">{tr.subtitle}</p>
        </div>
        <label className="fld admin-search">
          <span className="sr-only">{tr.search}</span>
          <input
            className="inp"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr.searchPlaceholder}
            aria-label={tr.search}
          />
        </label>
      </div>

      {k && (
        <div className="kpis kpis-4">
          <Kpi value={k.endsSoon} label={tr.kpis.endsSoon} />
          <Kpi value={k.endThisWeek} label={tr.kpis.endThisWeek} />
          <Kpi value={k.endedNotPaid} label={tr.kpis.endedNotPaid} />
          <Kpi
            value={k.conversion ? `${Math.round((k.conversion.paid / k.conversion.ended) * 100)}%` : tr.kpis.noConversion}
            label={tr.kpis.conversion}
            note={k.conversion ? tr.kpis.conversionNote(k.conversion.paid, k.conversion.ended) : undefined}
          />
        </div>
      )}

      <div className="chips" role="group" aria-label={tr.title}>
        {TRIAL_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`chip${filter === f ? ' on' : ''}`}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {tr.filters[f]}
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
      {data && data.trials.length === 0 && <p className="card admin-empty muted">{query.trim() ? tr.empty : tr.none[filter]}</p>}
      {data && data.trials.length > 0 && (
        <div className="card table-card">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{tr.cols.business}</th>
                <th>{tr.cols.trial}</th>
                <th className="num">{tr.cols.setup}</th>
                <th className="num">{tr.cols.bookings}</th>
                <th>{tr.cols.payments}</th>
                <th>{tr.cols.lastActive}</th>
                <th>
                  <span className="sr-only">{tr.extend}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.trials.map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="card admin-note small">{tr.footnote}</p>
    </div>
  );
}

function Row({ row }: { row: TrialRow }) {
  const href = `/admin/businesses/${row.id}`;
  const day = formatDay(row.trialEndsAt);
  const owner = row.ownerName ?? row.name;
  const message = row.ended ? tr.whatsappEnded(owner, row.name, day) : tr.whatsappEnding(owner, row.name, day);
  return (
    <tr>
      <td>
        <Link className="row-title" href={href}>
          {row.name}
        </Link>
        <div className="muted small">{s.contact.businessTypes[row.template]}</div>
      </td>
      <td>
        {row.ended ? (
          <>
            <span className="tag tag-gray">{tr.endedOn(day)}</span>
            <div className="muted small">{tr.pagePaused}</div>
          </>
        ) : (
          <>
            <span className={row.daysLeft <= 1 ? 'tag tag-red' : 'tag tag-pend'}>{tr.endsIn(row.daysLeft)}</span>
            <div className="muted small">
              {day}
              {row.extended && ` · ${tr.pilot}`}
            </div>
          </>
        )}
      </td>
      <td className="num">
        <strong>
          {row.setupDone}/{row.setupTotal}
        </strong>
      </td>
      <td className="num">{row.bookingsInTrial}</td>
      <td>
        <span className={PAYMENT_TAG[row.payments]}>{tr.payments[row.payments]}</span>
      </td>
      <td>{row.lastActiveAt ? tr.lastActive(-daysUntil(row.lastActiveAt)) : tr.never}</td>
      <td className="actions-cell">
        <div className="row-actions">
          {row.phone && (
            <a
              className="btn2 btn-sm"
              href={whatsappLink(row.phone, message)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={tr.whatsapp(row.name)}
            >
              WhatsApp
            </a>
          )}
          <Link className="btn btn-sm" href={`${href}#extend`}>
            {tr.extend}
          </Link>
        </div>
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
