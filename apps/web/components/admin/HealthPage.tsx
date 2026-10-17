'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  emailProblemAdvice,
  type EmailProblemItem,
  type FailedJobItem,
  type HealthTile,
  type PaymentCheckItem,
  type RecheckResult,
  type SystemHealth,
} from '@outletbooking/shared';
import { closePaymentCheck, getSystemHealth, recheckPaymentCheck, retryFailedJob, type Result } from '@/lib/admin-api';
import { formatDateTime } from '@/lib/admin-format';
import { formatRm } from '@/lib/money';
import { s } from '@/strings/en';
import { ReasonForm } from './ReasonForm';
import { useAdmin } from './AdminShell';

const t = s.admin;
const h = t.health;

type State = { kind: 'loading' } | { kind: 'ok'; data: SystemHealth } | { kind: 'error' };

const LIGHT_CLASS: Record<HealthTile['light'], string> = { ok: 'tag tag-ok', warn: 'tag tag-pend', down: 'tag tag-red', off: 'tag tag-gray' };

/** The words on a tile: "OK · 120 ms", "2 to check", "Not running here". */
function tileText(key: 'api' | 'database' | 'toyyibpay' | 'jobs' | 'email' | 'push', tile: HealthTile): string {
  if (tile.light === 'down') return h.down;
  if (tile.light === 'off') return tile.note ? h.off[tile.note] : h.ok;
  if (key === 'toyyibpay' && tile.count) return h.toCheck(tile.count);
  if (key === 'jobs' && tile.count) return h.failed(tile.count);
  if (key === 'email' && tile.count) return h.problems(tile.count);
  if (tile.ms !== null) return tile.light === 'warn' ? h.slowMs(tile.ms) : h.okMs(tile.ms);
  return h.ok;
}

/** I27 · System health: is everything working, and what needs a person. Refreshes every minute. */
export function HealthPage() {
  const { signedOut } = useAdmin();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const r = await getSystemHealth();
    setRefreshing(false);
    if (r.kind === 'signed_out') return signedOut();
    setState((old) => (r.kind === 'ok' ? { kind: 'ok', data: r.data } : old.kind === 'ok' ? old : { kind: 'error' }));
  }, [signedOut]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>{h.title}</h1>
          {state.kind === 'ok' && <p className="muted">{h.updated(formatDateTime(state.data.checkedAt))}</p>}
        </div>
        <button type="button" className="btn2" onClick={() => void load()} disabled={refreshing}>
          {refreshing ? h.refreshing : h.refresh}
        </button>
      </div>

      {state.kind === 'loading' && <p className="muted admin-empty">{t.loading}</p>}
      {state.kind === 'error' && (
        <div className="admin-empty">
          <p className="alert alert-error" role="alert">
            {h.loadError}
          </p>
          <button type="button" className="btn2" onClick={() => void load()}>
            {t.retry}
          </button>
        </div>
      )}
      {state.kind === 'ok' && (
        <>
          <ul className="health-tiles" style={{ listStyle: 'none', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            {(['api', 'database', 'toyyibpay', 'jobs', 'email', 'push'] as const).map((key) => (
              <li key={key} className="card kpi">
                <div className="kpi-label">{h.tiles[key]}</div>
                <div>
                  <span className={LIGHT_CLASS[state.data[key].light]}>{tileText(key, state.data[key])}</span>
                </div>
              </li>
            ))}
          </ul>
          <PaymentChecks items={state.data.paymentChecks} onChanged={() => void load()} signedOut={signedOut} />
          <FailedJobs items={state.data.failedJobs} onChanged={() => void load()} signedOut={signedOut} />
          <EmailProblems items={state.data.emailProblems} />
        </>
      )}
    </div>
  );
}

function PaymentChecks({ items, onChanged, signedOut }: { items: PaymentCheckItem[]; onChanged: () => void; signedOut: () => void }) {
  const p = h.payments;
  const [busyId, setBusyId] = useState<number | null>(null);
  const [closingId, setClosingId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ id: number; kind: 'ok' | 'error'; text: string } | null>(null);

  async function recheck(id: number) {
    setBusyId(id);
    setMessage(null);
    const r: Result<RecheckResult> = await recheckPaymentCheck(id);
    setBusyId(null);
    if (r.kind === 'signed_out') return signedOut();
    if (r.kind !== 'ok') return setMessage({ id, kind: 'error', text: r.kind === 'refused' ? r.message : h.actionError });
    setMessage({ id, kind: r.data.outcome === 'paid' ? 'ok' : 'error', text: p.results[r.data.outcome] });
    onChanged();
  }

  return (
    <section className="card table-card" aria-labelledby="health-payments">
      <h2 id="health-payments" className="admin-section">
        {p.title}
      </h2>
      {items.length === 0 ? (
        <p className="muted admin-empty">{p.empty}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>{p.columns.when}</th>
                <th>{p.columns.business}</th>
                <th>{p.columns.bill}</th>
                <th>{p.columns.problem}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>{formatDateTime(c.checkedAt)}</td>
                  <td>
                    <Link href={`/admin/businesses/${c.business.id}`}>{c.business.name}</Link>
                    <div className="muted small">{c.bookingRef ? p.booking(c.bookingRef) : p.plan}</div>
                  </td>
                  <td>
                    <code>{c.billCode}</code>
                    <div className="muted small">{formatRm(c.amountSen)}</div>
                  </td>
                  <td>
                    {c.problem === 'callback_recheck_mismatch' ? p.problems.callback_recheck_mismatch(c.callbackStatus, c.recheckStatus) : p.problems[c.problem]}
                    {message?.id === c.id && (
                      <p className={message.kind === 'ok' ? 'alert alert-ok' : 'alert alert-error'} role="status">
                        {message.text}
                      </p>
                    )}
                    {closingId === c.id && (
                      <ReasonForm
                        label={p.closeLabel}
                        submit={p.closeSubmit}
                        onCancel={() => setClosingId(null)}
                        onSubmit={async (reason) => {
                          const r = await closePaymentCheck(c.id, reason);
                          if (r.kind === 'signed_out') {
                            signedOut();
                            return null;
                          }
                          if (r.kind !== 'ok') return r.kind === 'refused' ? r.message : h.actionError;
                          setClosingId(null);
                          onChanged();
                          return null;
                        }}
                      />
                    )}
                  </td>
                  <td className="actions">
                    <button type="button" className="btn btn-sm" disabled={busyId === c.id} onClick={() => void recheck(c.id)}>
                      {busyId === c.id ? p.rechecking : p.recheck}
                    </button>{' '}
                    <button type="button" className="btn2 btn-sm" disabled={busyId === c.id} onClick={() => setClosingId(closingId === c.id ? null : c.id)}>
                      {p.close}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small admin-section">{p.note}</p>
    </section>
  );
}

function FailedJobs({ items, onChanged, signedOut }: { items: FailedJobItem[]; onChanged: () => void; signedOut: () => void }) {
  const j = h.jobs;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function retry(job: FailedJobItem) {
    setBusyId(job.id);
    setError(null);
    const r = await retryFailedJob(job.name, job.id);
    setBusyId(null);
    if (r.kind === 'signed_out') return signedOut();
    if (r.kind !== 'ok') return setError(r.kind === 'refused' ? r.message : h.actionError);
    onChanged();
  }

  return (
    <section className="card table-card" aria-labelledby="health-jobs">
      <h2 id="health-jobs" className="admin-section">
        {j.title}
      </h2>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <p className="muted admin-empty">{j.empty}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>{j.columns.job}</th>
                <th>{j.columns.error}</th>
                <th>{j.columns.tries}</th>
                <th>{j.columns.when}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((job) => (
                <tr key={job.id}>
                  <td>
                    <code>{job.name}</code>
                  </td>
                  <td>{job.error}</td>
                  <td>{j.tries(job.tries, job.maxTries)}</td>
                  <td>{formatDateTime(job.failedAt)}</td>
                  <td className="actions">
                    <button type="button" className="btn btn-sm" disabled={busyId === job.id} onClick={() => void retry(job)}>
                      {busyId === job.id ? j.retrying : j.retry}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EmailProblems({ items }: { items: EmailProblemItem[] }) {
  const e = h.emails;
  return (
    <section className="card table-card" aria-labelledby="health-emails">
      <h2 id="health-emails" className="admin-section">
        {e.title}
      </h2>
      {items.length === 0 ? (
        <p className="muted admin-empty">{e.empty}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>{e.columns.email}</th>
                <th>{e.columns.to}</th>
                <th>{e.columns.business}</th>
                <th>{e.columns.problem}</th>
                <th>{e.columns.todo}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id}>
                  <td>
                    {e.templates[m.template as keyof typeof e.templates] ?? m.template}
                    <div className="muted small">{formatDateTime(m.at)}</div>
                  </td>
                  <td>{m.toMasked}</td>
                  <td>{m.business ? <Link href={`/admin/businesses/${m.business.id}`}>{m.business.name}</Link> : e.noBusiness}</td>
                  <td>
                    <span className="tag tag-red">{e.status[m.status]}</span>
                    {m.detail && <div className="muted small">{m.detail}</div>}
                  </td>
                  <td>{e.advice[emailProblemAdvice(m.status)]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
