'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { DELETION_TABS, type DeletionQueue, type DeletionRow, type DeletionTab } from '@outletbooking/shared';
import { getDeletionQueue, holdDeletion, releaseDeletion, sendDeletionNotice, type Result } from '@/lib/admin-api';
import { daysUntil, formatDate } from '@/lib/admin-format';
import { s } from '@/strings/en';
import { ReasonForm } from './ReasonForm';
import { useAdmin } from './AdminShell';

const t = s.admin;
const p = t.deletion;

type State = { kind: 'loading' } | { kind: 'ok'; data: DeletionQueue } | { kind: 'error' };
type Panel = { id: number; kind: 'hold' | 'release' } | null;

/** The words in the "Why" column. */
function whyText(r: DeletionRow): string {
  return r.reason === 'close_request' ? p.why.close_request(r.since ? formatDate(r.since) : null) : p.why.unpaid(r.unpaidMonths);
}

/** The words in the "Status" column, and the delete date. */
function statusText(r: DeletionRow): { status: string; date: string | null } {
  if (r.tab === 'done') return { status: p.status.done(r.deletedAt ? formatDate(r.deletedAt) : ''), date: null };
  if (r.tab === 'on_hold') return { status: p.status.hold, date: null };
  if (r.tab === 'todo') return { status: p.status.todo, date: null };
  const date = r.deleteOn ? (daysUntil(r.deleteOn) <= 0 ? `${p.status.deletes(formatDate(r.deleteOn))} · ${p.status.today}` : p.status.deletes(formatDate(r.deleteOn))) : null;
  return { status: p.status.notice(r.noticeSentAt ? formatDate(r.noticeSentAt) : null), date };
}

/** I26 · Data deletion: who is due, the notice, hold, and what deleting does. Deleting itself is only done by the daily job. */
export function DeletionPage() {
  const { admin, signedOut } = useAdmin();
  const superAdmin = admin.role === 'super_admin';
  const [tab, setTab] = useState<DeletionTab>('todo');
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [panel, setPanel] = useState<Panel>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await getDeletionQueue(tab);
    if (r.kind === 'signed_out') return signedOut();
    setState(r.kind === 'ok' ? { kind: 'ok', data: r.data } : { kind: 'error' });
  }, [tab, signedOut]);

  useEffect(() => {
    setState({ kind: 'loading' });
    void load();
  }, [load]);

  function fail(r: Result<unknown>): string | null {
    if (r.kind === 'ok') return null;
    if (r.kind === 'signed_out') {
      signedOut();
      return null;
    }
    return r.kind === 'refused' ? r.message : p.actionError;
  }

  async function notice(id: number) {
    setBusyId(id);
    setMessage(null);
    const r = await sendDeletionNotice(id);
    setBusyId(null);
    const err = fail(r);
    if (err) return setMessage({ kind: 'error', text: err });
    if (r.kind === 'ok') {
      setMessage({ kind: 'ok', text: p.noticeSent });
      void load();
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>{p.title}</h1>
          <p className="muted">{p.subtitle}</p>
        </div>
      </div>

      {state.kind === 'ok' && (
        <>
          <div className="kpis kpis-4">
            <Kpi value={state.data.summary.noticeToSend} label={p.kpis.noticeToSend} />
            <Kpi value={state.data.summary.deletingSoon} label={p.kpis.deletingSoon} />
            <Kpi value={state.data.summary.onHold} label={p.kpis.onHold} />
            <Kpi value={state.data.summary.deletedThisYear} label={p.kpis.deletedThisYear} />
          </div>
          <p className={state.data.summary.autoDeleteEnabled ? 'card admin-note small' : 'alert alert-error small'} role="status">
            {state.data.summary.autoDeleteEnabled ? p.autoOn : p.autoOff}
          </p>
        </>
      )}

      <div className="chips" role="group" aria-label={p.title}>
        {DELETION_TABS.map((key) => (
          <button
            key={key}
            type="button"
            className={`chip${tab === key ? ' on' : ''}`}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              setPanel(null);
              setMessage(null);
            }}
          >
            {p.tabs[key]}
          </button>
        ))}
      </div>

      {message && (
        <p className={message.kind === 'ok' ? 'alert alert-ok' : 'alert alert-error'} role="status">
          {message.text}
        </p>
      )}

      <div className="card table-card">
        {state.kind === 'loading' && <p className="muted admin-empty">{t.loading}</p>}
        {state.kind === 'error' && (
          <div className="admin-empty">
            <p className="alert alert-error" role="alert">
              {p.loadError}
            </p>
            <button type="button" className="btn2" onClick={() => void load()}>
              {t.retry}
            </button>
          </div>
        )}
        {state.kind === 'ok' && state.data.rows.length === 0 && <p className="muted admin-empty">{p.empty[tab]}</p>}
        {state.kind === 'ok' && state.data.rows.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>{p.columns.business}</th>
                <th>{p.columns.why}</th>
                <th>{p.columns.status}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.data.rows.map((r) => {
                const st = statusText(r);
                return (
                  <tr key={r.id}>
                    <td>
                      {r.tab === 'done' ? r.name : <Link href={`/admin/businesses/${r.id}`}>{r.name}</Link>}
                      <div className="muted small">{p.types[r.template]}</div>
                    </td>
                    <td>{whyText(r)}</td>
                    <td>
                      {st.status}
                      {st.date && <div className="muted small">{st.date}</div>}
                      {r.holdReason && <div className="muted small">“{r.holdReason}”</div>}
                      {panel?.id === r.id && (
                        <ReasonForm
                          label={panel.kind === 'hold' ? p.holdLabel : p.releaseLabel}
                          submit={panel.kind === 'hold' ? p.holdSubmit : p.releaseSubmit}
                          onCancel={() => setPanel(null)}
                          onSubmit={async (reason) => {
                            const res = panel.kind === 'hold' ? await holdDeletion(r.id, reason) : await releaseDeletion(r.id, reason);
                            const err = fail(res);
                            if (err) return err;
                            setPanel(null);
                            void load();
                            return null;
                          }}
                        />
                      )}
                      {panel?.id === r.id && panel.kind === 'release' && <p className="muted small">{p.releaseNote}</p>}
                    </td>
                    <td className="actions">
                      {r.tab === 'done' ? null : !superAdmin ? (
                        <span className="muted small">{p.superOnly}</span>
                      ) : (
                        <>
                          {r.tab === 'todo' && (
                            <button type="button" className="btn btn-sm" disabled={busyId === r.id} onClick={() => void notice(r.id)}>
                              {busyId === r.id ? p.sendingNotice : p.sendNotice}
                            </button>
                          )}{' '}
                          {r.tab === 'on_hold' ? (
                            <button type="button" className="btn2 btn-sm" onClick={() => setPanel(panel?.id === r.id ? null : { id: r.id, kind: 'release' })}>
                              {p.release}
                            </button>
                          ) : (
                            <button type="button" className="btn2 btn-sm" onClick={() => setPanel(panel?.id === r.id ? null : { id: r.id, kind: 'hold' })}>
                              {p.hold}
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="biz-grid">
        <section className="card admin-section">
          <h2>{p.doesTitle}</h2>
          <ul>
            {p.does.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
        <section className="card admin-section">
          <h2>{p.timingTitle}</h2>
          <dl className="account-facts">
            {p.timing.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="muted small">{p.rule}</p>
        </section>
      </div>
    </div>
  );
}

function Kpi({ value, label }: { value: number; label: string }) {
  return (
    <div className="card kpi">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}
