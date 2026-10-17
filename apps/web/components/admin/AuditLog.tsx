'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ADMIN_ACTIONS, type AdminAction, type AdminUserOption, type AuditEntry, type AuditLogFilters } from '@outletbooking/shared';
import { exportAuditLog, listAdmins, listAuditLog } from '@/lib/admin-api';
import { formatDateTime } from '@/lib/admin-format';
import { auditChange } from '@/lib/audit-format';
import { s } from '@/strings/en';
import { useAdmin } from './AdminShell';

const t = s.admin;
const a = t.audit;
const PAGE = 50;

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; entries: AuditEntry[]; hasMore: boolean; loadingMore: boolean }
  | { kind: 'error' };

const EMPTY: AuditLogFilters = {};

/** I9 · Full audit log: filters by admin, action, business and dates; reason and before → after; export CSV. Read only. */
export function AuditLog() {
  const { signedOut } = useAdmin();
  const [filters, setFilters] = useState<AuditLogFilters>(EMPTY);
  const [businessText, setBusinessText] = useState('');
  const [admins, setAdmins] = useState<AdminUserOption[]>([]);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);

  const badDates = Boolean(filters.from && filters.to && filters.from > filters.to);
  const filtered = Object.values(filters).some((v) => v !== undefined) || businessText.trim() !== '';

  useEffect(() => {
    void listAdmins().then((r) => {
      if (r.kind === 'ok') setAdmins(r.data);
    });
  }, []);

  // Search businesses a moment after the last key.
  useEffect(() => {
    const timer = setTimeout(() => {
      const business = businessText.trim() || undefined;
      setFilters((f) => (f.business === business ? f : { ...f, business }));
    }, 300);
    return () => clearTimeout(timer);
  }, [businessText]);

  useEffect(() => {
    if (badDates) return;
    let live = true;
    setState({ kind: 'loading' });
    void listAuditLog(filters, PAGE).then((r) => {
      if (!live) return;
      if (r.kind === 'ok') setState({ kind: 'ok', entries: r.data, hasMore: r.data.length === PAGE, loadingMore: false });
      else if (r.kind === 'signed_out') signedOut();
      else setState({ kind: 'error' });
    });
    return () => {
      live = false;
    };
  }, [filters, badDates, attempt, signedOut]);

  const set = <K extends keyof AuditLogFilters>(key: K, value: AuditLogFilters[K] | '') =>
    setFilters((f) => ({ ...f, [key]: value === '' ? undefined : value }));

  async function loadMore() {
    if (state.kind !== 'ok' || state.loadingMore) return;
    const last = state.entries[state.entries.length - 1];
    if (!last) return;
    setState({ ...state, loadingMore: true });
    const r = await listAuditLog(filters, PAGE, last.id);
    if (r.kind === 'ok') {
      setState({ kind: 'ok', entries: [...state.entries, ...r.data], hasMore: r.data.length === PAGE, loadingMore: false });
    } else if (r.kind === 'signed_out') signedOut();
    else setState({ ...state, loadingMore: false, hasMore: true });
  }

  async function exportCsv() {
    setExporting(true);
    setExportFailed(false);
    const r = await exportAuditLog(filters);
    setExporting(false);
    if (r.kind === 'signed_out') return signedOut();
    if (r.kind === 'error') return setExportFailed(true);
    const url = URL.createObjectURL(r.file);
    const link = document.createElement('a');
    link.href = url;
    link.download = r.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>{a.title}</h1>
          <p className="muted">{a.subtitle}</p>
        </div>
        <button type="button" className="btn2" onClick={exportCsv} disabled={exporting || badDates}>
          {exporting ? a.exporting : a.export}
        </button>
      </div>
      {exportFailed && (
        <p className="alert alert-error" role="alert">
          {a.exportError}
        </p>
      )}

      <div className="card audit-filters" role="group" aria-label={a.filters.label}>
        <label className="fld">
          <span className="lbl">{a.filters.admin}</span>
          <select
            className="inp"
            value={filters.adminId ?? ''}
            onChange={(e) => set('adminId', e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">{a.filters.anyAdmin}</option>
            {admins.map((u) => (
              <option key={u.userId} value={u.userId}>
                {u.isActive ? u.name : a.filters.removed(u.name)}
              </option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span className="lbl">{a.filters.action}</span>
          <select className="inp" value={filters.action ?? ''} onChange={(e) => set('action', e.target.value as AdminAction | '')}>
            <option value="">{a.filters.anyAction}</option>
            {ADMIN_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {t.actions[action]}
              </option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span className="lbl">{a.filters.business}</span>
          <input
            className="inp"
            type="search"
            value={businessText}
            onChange={(e) => setBusinessText(e.target.value)}
            placeholder={a.filters.businessPlaceholder}
          />
        </label>
        <label className="fld">
          <span className="lbl">{a.filters.from}</span>
          <input
            className="inp"
            type="date"
            value={filters.from ?? ''}
            max={filters.to}
            aria-invalid={badDates || undefined}
            onChange={(e) => set('from', e.target.value)}
          />
        </label>
        <label className="fld">
          <span className="lbl">{a.filters.to}</span>
          <input
            className="inp"
            type="date"
            value={filters.to ?? ''}
            min={filters.from}
            aria-invalid={badDates || undefined}
            onChange={(e) => set('to', e.target.value)}
          />
        </label>
        {filtered && (
          <button
            type="button"
            className="btn2 btn-sm audit-clear"
            onClick={() => {
              setBusinessText('');
              setFilters(EMPTY);
            }}
          >
            {a.filters.clear}
          </button>
        )}
      </div>

      {badDates && (
        <p className="alert alert-error" role="alert">
          {a.filters.badDates}
        </p>
      )}
      {!badDates && state.kind === 'loading' && <p className="muted">{t.loading}</p>}
      {!badDates && state.kind === 'error' && (
        <div className="card admin-card">
          <p className="alert alert-error" role="alert">
            {t.loadError}
          </p>
          <button type="button" className="btn2" onClick={() => setAttempt((n) => n + 1)}>
            {t.retry}
          </button>
        </div>
      )}
      {!badDates && state.kind === 'ok' && state.entries.length === 0 && (
        <p className="card admin-empty muted">{filtered ? a.empty : a.none}</p>
      )}
      {!badDates && state.kind === 'ok' && state.entries.length > 0 && (
        <div className="card table-card">
          <table className="admin-table audit-table">
            <thead>
              <tr>
                <th>{a.cols.when}</th>
                <th>{a.cols.admin}</th>
                <th>{a.cols.action}</th>
                <th>{a.cols.business}</th>
                <th>{a.cols.reason}</th>
                <th>{a.cols.change}</th>
              </tr>
            </thead>
            <tbody>
              {state.entries.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{formatDateTime(e.createdAt)}</td>
                  <td className="nowrap">{e.admin?.name ?? a.system}</td>
                  <td className="nowrap">
                    <strong>{t.actions[e.action] ?? e.action}</strong>
                  </td>
                  <td>
                    {e.business ? (
                      <Link className="row-title" href={`/admin/businesses/${e.business.id}`}>
                        {e.business.name}
                      </Link>
                    ) : (
                      <span className="muted">{a.noBusiness}</span>
                    )}
                  </td>
                  <td className="muted audit-reason">“{e.reason}”</td>
                  <td className="audit-change">{auditChange(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!badDates && state.kind === 'ok' && state.hasMore && (
        <div>
          <button type="button" className="btn2" onClick={loadMore} disabled={state.loadingMore}>
            {state.loadingMore ? a.loadingMore : a.more}
          </button>
        </div>
      )}

      <p className="muted small">{a.footnote}</p>
    </div>
  );
}
