'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ADMIN_BUSINESS_FILTERS, type AdminBusinessFilter, type AdminBusinessesResponse } from '@outletbooking/shared';
import { listBusinesses } from '@/lib/admin-api';
import { formatPhone } from '@/lib/admin-format';
import { formatRm } from '@/lib/money';
import { s } from '@/strings/en';
import { useAdmin } from './AdminShell';
import { StateTag, untilLabel } from './status';

const t = s.admin;
const b = t.businesses;

type State = { kind: 'loading' } | { kind: 'ok'; data: AdminBusinessesResponse } | { kind: 'error' };

/** I1 · All businesses: KPIs, search, filter chips, table. */
export function BusinessesList() {
  const { signedOut } = useAdmin();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AdminBusinessFilter>('all');
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // Search as you type, a moment after the last key.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    let live = true;
    void listBusinesses(query, filter).then((r) => {
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
          <h1>{b.title}</h1>
          <p className="muted">{b.subtitle}</p>
        </div>
        <label className="fld admin-search">
          <span className="sr-only">{b.search}</span>
          <input
            className="inp"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={b.searchPlaceholder}
            aria-label={b.search}
          />
        </label>
      </div>

      {k && (
        <div className="kpis">
          <Kpi value={k.businesses} label={b.kpis.businesses} />
          <Kpi value={k.onTrial} label={b.kpis.onTrial} note={k.trialEndingThisWeek ? b.kpis.endThisWeek(k.trialEndingThisWeek) : undefined} />
          <Kpi value={k.paying} label={b.kpis.paying} />
          <Kpi value={k.trialEnded} label={b.kpis.ended} />
          <Kpi value={formatRm(k.revenue30dSen)} label={b.kpis.revenue} />
        </div>
      )}

      <div className="chips" role="group" aria-label={b.title}>
        {ADMIN_BUSINESS_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`chip${filter === f ? ' on' : ''}`}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {b.filters[f]}
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
      {data && data.businesses.length === 0 && (
        <p className="card admin-empty muted">{k?.businesses ? b.empty : b.none}</p>
      )}
      {data && data.businesses.length > 0 && (
        <div className="card table-card">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{b.cols.business}</th>
                <th>{b.cols.type}</th>
                <th>{b.cols.owner}</th>
                <th>{b.cols.status}</th>
                <th>{b.cols.until}</th>
                <th className="num">{b.cols.bookings}</th>
                <th>
                  <span className="sr-only">{b.view}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.businesses.map((row) => {
                const href = `/admin/businesses/${row.id}`;
                const canExtend = row.state === 'trial' || row.state === 'ended';
                return (
                  <tr key={row.id}>
                    <td>
                      <Link className="row-title" href={href}>
                        {row.name}
                      </Link>
                      <div className="muted small">/{row.slug}</div>
                    </td>
                    <td>{s.contact.businessTypes[row.template]}</td>
                    <td>
                      {row.ownerName ?? '—'}
                      {row.phone && <div className="muted small">{formatPhone(row.phone)}</div>}
                    </td>
                    <td>
                      <StateTag business={row} />
                      {!row.bookingEnabled && <div className="muted small">{b.paused}</div>}
                    </td>
                    <td>{untilLabel(row)}</td>
                    <td className="num">{row.bookings30d}</td>
                    <td className="actions-cell">
                      <Link className={canExtend ? 'btn btn-sm' : 'btn2 btn-sm'} href={canExtend ? `${href}#extend` : href}>
                        {canExtend ? b.extend : b.view}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
