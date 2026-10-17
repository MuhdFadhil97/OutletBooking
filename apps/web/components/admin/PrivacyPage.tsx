'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  PRIVACY_CHECKLIST,
  PRIVACY_KINDS,
  PRIVACY_REQUESTERS,
  PRIVACY_TABS,
  type PrivacyChecklistStep,
  type PrivacyKind,
  type PrivacyRequester,
  type PrivacyRequestDetail,
  type PrivacyRequestRow,
  type PrivacyStatus,
  type PrivacySummary,
  type PrivacyTab,
} from '@outletbooking/shared';
import {
  createPrivacyRequest,
  extendPrivacyRequest,
  getPrivacyRequest,
  getPrivacySummary,
  listBusinesses,
  listPrivacyRequests,
  setPrivacyChecklist,
  setPrivacyNotes,
  setPrivacyStatus,
  type Result,
} from '@/lib/admin-api';
import { formatDate, formatPhone, whatsappLink, ymdInMalaysia } from '@/lib/admin-format';
import { deadlineText, type DeadlineTone } from '@/lib/privacy-format';
import { s } from '@/strings/en';
import { ReasonForm } from './ReasonForm';
import { useAdmin } from './AdminShell';

const t = s.admin;
const p = t.privacy;

type Selection = { type: 'request'; id: number } | { type: 'new' } | null;
type ListState = { kind: 'loading' } | { kind: 'ok'; rows: PrivacyRequestRow[] } | { kind: 'error' };

const STATUS_TAG: Record<PrivacyStatus, string> = {
  open: 'tag tag-blue',
  waiting_id_check: 'tag tag-pend',
  in_progress: 'tag tag-blue',
  sent_to_business: 'tag tag-pend',
  done: 'tag tag-ok',
  rejected: 'tag tag-gray',
};
const TONE_TAG: Record<DeadlineTone, string> = { late: 'tag tag-red', soon: 'tag tag-pend', ok: 'tag tag-gray', closed: 'muted' };
/** Statuses an admin can move a request to by hand (done and rejected have their own buttons). */
const MANUAL_STATUSES: PrivacyStatus[] = ['open', 'waiting_id_check', 'in_progress', 'sent_to_business'];

/** A failed call: the API's message, or the generic one. `signed_out` leaves the page. */
function problem(r: Result<unknown>, signedOut: () => void): string | null {
  if (r.kind === 'ok') return null;
  if (r.kind === 'signed_out') {
    signedOut();
    return null;
  }
  return r.kind === 'refused' ? r.message : p.detail.error;
}

/** I25 · Privacy requests (PDPA): who asked for what, the four steps, and the 21-day deadline. */
export function PrivacyPage() {
  const { signedOut } = useAdmin();
  const [tab, setTab] = useState<PrivacyTab>('open');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [summary, setSummary] = useState<PrivacySummary | null>(null);
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [selected, setSelected] = useState<Selection>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const refresh = useCallback(() => setVersion((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    void Promise.all([getPrivacySummary(), listPrivacyRequests(tab, query)]).then(([sum, rows]) => {
      if (!live) return;
      if (sum.kind === 'signed_out' || rows.kind === 'signed_out') return signedOut();
      if (sum.kind === 'ok') setSummary(sum.data);
      setList(rows.kind === 'ok' ? { kind: 'ok', rows: rows.data } : { kind: 'error' });
    });
    return () => {
      live = false;
    };
  }, [tab, query, version, signedOut]);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>{p.title}</h1>
          <p className="muted">{p.subtitle}</p>
        </div>
        <button type="button" className="btn" onClick={() => setSelected({ type: 'new' })}>
          {p.log}
        </button>
      </div>

      <div className="kpis kpis-3">
        <Kpi value={summary?.open ?? '–'} label={p.kpis.open} />
        <Kpi value={summary?.dueSoon ?? '–'} label={p.kpis.dueSoon} />
        <Kpi value={summary?.overdue ?? '–'} label={p.kpis.overdue} />
      </div>

      <div className="chips" role="group" aria-label={p.title}>
        {PRIVACY_TABS.map((key) => (
          <button
            key={key}
            type="button"
            className={`chip${tab === key ? ' on' : ''}`}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              setSelected(null);
            }}
          >
            {p.tabs[key]}
          </button>
        ))}
        <label className="fld admin-search" style={{ marginLeft: 'auto' }}>
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
      </div>

      <div className="support-grid">
        <div className="card table-card">
          {list.kind === 'loading' && <p className="muted admin-empty">{t.loading}</p>}
          {list.kind === 'error' && (
            <div className="admin-empty">
              <p className="alert alert-error" role="alert">
                {p.loadError}
              </p>
              <button type="button" className="btn2" onClick={refresh}>
                {t.retry}
              </button>
            </div>
          )}
          {list.kind === 'ok' && list.rows.length === 0 && <p className="muted admin-empty">{query.trim() ? p.empty : p.emptyTab[tab]}</p>}
          {list.kind === 'ok' && list.rows.length > 0 && (
            <ul className="support-list">
              {list.rows.map((r) => {
                const d = deadlineText(r, p.deadline);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="support-item"
                      aria-current={selected?.type === 'request' && selected.id === r.id}
                      onClick={() => setSelected({ type: 'request', id: r.id })}
                    >
                      <span className="support-item-top">
                        <span>{r.requesterName}</span>
                        <span className={STATUS_TAG[r.status]}>{p.status[r.status]}</span>
                      </span>
                      <span className="muted small">
                        {[p.kinds[r.kind], r.business ? `${p.requesters[r.requesterKind]} · ${r.business.name}` : p.requesters[r.requesterKind], formatDate(r.receivedAt)].join(' · ')}
                      </span>
                      <span className={`${TONE_TAG[d.tone]} small`}>{d.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          {selected === null && <p className="card admin-empty muted">{p.pick}</p>}
          {selected?.type === 'new' && (
            <NewRequest
              signedOut={signedOut}
              onCancel={() => setSelected(null)}
              onCreated={(id) => {
                setTab('open');
                setSelected({ type: 'request', id });
                refresh();
              }}
            />
          )}
          {selected?.type === 'request' && <RequestDetail key={selected.id} id={selected.id} signedOut={signedOut} onChanged={refresh} />}
        </div>
      </div>

      <p className="card admin-note small">{p.footnote}</p>
    </div>
  );
}

function Kpi({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="card kpi">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

function RequestDetail({ id, signedOut, onChanged }: { id: number; signedOut: () => void; onChanged: () => void }) {
  const d = p.detail;
  const [detail, setDetail] = useState<PrivacyRequestDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [panel, setPanel] = useState<'reject' | 'more_time' | null>(null);

  useEffect(() => {
    let live = true;
    void getPrivacyRequest(id).then((r) => {
      if (!live) return;
      if (r.kind === 'signed_out') return signedOut();
      if (r.kind === 'ok') {
        setDetail(r.data);
        setNotes(r.data.notes ?? '');
      } else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [id, signedOut]);

  async function run(call: () => Promise<Result<PrivacyRequestDetail>>, after?: () => void): Promise<string | null> {
    setBusy(true);
    setError(null);
    const r = await call();
    setBusy(false);
    const err = problem(r, signedOut);
    if (err) {
      setError(err);
      return err;
    }
    if (r.kind === 'ok') {
      setDetail(r.data);
      setNotes(r.data.notes ?? '');
      after?.();
      onChanged();
    }
    return null;
  }

  if (failed) return <p className="card admin-empty alert alert-error">{p.loadError}</p>;
  if (!detail) return <p className="card admin-empty muted">{t.loading}</p>;

  const closed = detail.closedAt !== null;
  const dl = deadlineText(detail, p.deadline);
  const phone = detail.requesterPhone;
  const daysTotal = Math.round((Date.parse(detail.dueAt) - Date.parse(detail.receivedAt)) / 86_400_000);
  const onNotes = (ev: FormEvent) => {
    ev.preventDefault();
    void run(() => setPrivacyNotes(id, notes));
  };

  return (
    <section className="card admin-section" aria-labelledby="privacy-title">
      <div className="admin-page-head">
        <div>
          <h2 id="privacy-title">
            {detail.requesterName} · {p.kinds[detail.kind]}
          </h2>
          <p className="muted small">
            {[d.meta(detail.id), p.requesters[detail.requesterKind], d.receivedDue(formatDate(detail.receivedAt), formatDate(detail.dueAt), daysTotal)].join(' · ')}
          </p>
          <p className="small">
            <span className={STATUS_TAG[detail.status]}>{p.status[detail.status]}</span> <span className={TONE_TAG[dl.tone]}>{dl.text}</span>
          </p>
          {detail.extendedReason && <p className="muted small">{d.extendedNote(detail.extendedReason)}</p>}
        </div>
        <div className="actions">
          {phone && (
            <a className="btn2 btn-sm" href={whatsappLink(phone)} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
          )}
          {detail.requesterEmail && (
            <a className="btn2 btn-sm" href={`mailto:${detail.requesterEmail}`}>
              Email
            </a>
          )}
          {detail.business && (
            <Link className="btn2 btn-sm" href={`/admin/businesses/${detail.business.id}`}>
              {d.openBusiness}
            </Link>
          )}
        </div>
      </div>

      <dl className="account-facts">
        <dt>{d.contact}</dt>
        <dd>{[detail.requesterEmail, phone ? formatPhone(phone) : null].filter(Boolean).join(' · ')}</dd>
        <dt>{d.business}</dt>
        <dd>{detail.business?.name ?? d.none}</dd>
        <dt>{d.handledBy}</dt>
        <dd>{detail.handledBy?.name ?? d.none}</dd>
      </dl>
      {detail.requesterKind === 'customer' && <p className="muted small">{d.customerNote}</p>}

      <h3>{d.steps}</h3>
      <ul className="checklist-admin" style={{ listStyle: 'none', padding: 0 }}>
        {PRIVACY_CHECKLIST.map((step: PrivacyChecklistStep) => (
          <li key={step}>
            <label className="check">
              <input
                type="checkbox"
                checked={detail.checklist[step]}
                disabled={busy || closed || step === 'logged'}
                onChange={(e) => void run(() => setPrivacyChecklist(id, step, e.target.checked))}
              />
              {d.step[step]}
            </label>
          </li>
        ))}
      </ul>

      <div className="case-facts">
        <label className="fld">
          <span className="lbl">{d.status}</span>
          <select
            className="inp"
            value={detail.status}
            disabled={busy || closed}
            onChange={(e) => void run(() => setPrivacyStatus(id, e.target.value as PrivacyStatus))}
          >
            {(closed ? [detail.status] : [...new Set([...MANUAL_STATUSES, detail.status])]).map((st) => (
              <option key={st} value={st}>
                {p.status[st]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <form method="post" className="fld-stack" style={{ maxWidth: 'none', marginTop: 16 }} onSubmit={onNotes} noValidate>
        <label className="fld">
          <span className="lbl">{d.notes}</span>
          <textarea className="inp" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <span className="muted small">{d.notesHint}</span>
        </label>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="submit" className="btn2" disabled={busy || notes.trim() === (detail.notes ?? '')}>
            {busy ? d.saving : d.saveNotes}
          </button>
          {closed ? (
            <button type="button" className="btn2" disabled={busy} onClick={() => void run(() => setPrivacyStatus(id, 'in_progress'))}>
              {d.reopen}
            </button>
          ) : (
            <>
              <button type="button" className="btn" disabled={busy} onClick={() => void run(() => setPrivacyStatus(id, 'done'))}>
                {d.markDone}
              </button>
              <button type="button" className="btn2" disabled={busy || detail.extendedReason !== null} onClick={() => setPanel(panel === 'more_time' ? null : 'more_time')}>
                {detail.extendedReason !== null ? d.alreadyExtended : d.moreTime}
              </button>
              <button type="button" className="btn2" disabled={busy} onClick={() => setPanel(panel === 'reject' ? null : 'reject')}>
                {d.reject}
              </button>
            </>
          )}
        </div>
      </form>

      {panel === 'more_time' && !closed && (
        <ReasonForm
          label={d.moreTimeLabel}
          submit={d.moreTimeSubmit}
          onCancel={() => setPanel(null)}
          onSubmit={async (reason) => {
            const err = await run(() => extendPrivacyRequest(id, reason), () => setPanel(null));
            return err;
          }}
        />
      )}
      {panel === 'reject' && !closed && (
        <ReasonForm
          label={d.rejectLabel}
          submit={d.rejectSubmit}
          danger
          onCancel={() => setPanel(null)}
          onSubmit={async (reason) => run(() => setPrivacyStatus(id, 'rejected', reason), () => setPanel(null))}
        />
      )}
    </section>
  );
}

function NewRequest({
  signedOut,
  onCancel,
  onCreated,
}: {
  signedOut: () => void;
  onCancel: () => void;
  onCreated: (id: number) => void;
}) {
  const n = p.create;
  const today = ymdInMalaysia(new Date());
  const [name, setName] = useState('');
  const [requester, setRequester] = useState<PrivacyRequester>('owner');
  const [kind, setKind] = useState<PrivacyKind>('access');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [receivedOn, setReceivedOn] = useState(today);
  const [note, setNote] = useState('');
  const [business, setBusiness] = useState<{ id: number; name: string } | null>(null);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<{ id: number; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (business || search.trim().length < 2) {
      setFound([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void listBusinesses(search, 'all').then((r) => {
        if (live && r.kind === 'ok') setFound(r.data.businesses.slice(0, 5).map((b) => ({ id: b.id, name: b.name })));
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search, business]);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const r = await createPrivacyRequest({
      requesterName: name,
      requesterKind: requester,
      kind,
      ...(email.trim() ? { requesterEmail: email } : {}),
      ...(phone.trim() ? { requesterPhone: phone.trim() } : {}),
      ...(business ? { businessId: business.id } : {}),
      ...(receivedOn && receivedOn !== today ? { receivedOn } : {}),
      ...(note.trim() ? { notes: note } : {}),
    });
    setBusy(false);
    const err = problem(r, signedOut);
    if (err) return setError(err);
    if (r.kind === 'ok') onCreated(r.data.id);
  }

  return (
    <form method="post" className="card admin-section" onSubmit={submit} noValidate aria-labelledby="new-privacy">
      <h2 id="new-privacy">{n.title}</h2>
      <div className="fld-stack" style={{ maxWidth: 'none' }}>
        <label className="fld">
          <span className="lbl">{n.name}</span>
          <input className="inp" value={name} maxLength={200} placeholder={n.namePlaceholder} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="fld">
          <span className="lbl">{n.who}</span>
          <select className="inp" value={requester} onChange={(e) => setRequester(e.target.value as PrivacyRequester)}>
            {PRIVACY_REQUESTERS.map((k) => (
              <option key={k} value={k}>
                {p.requesters[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span className="lbl">{n.what}</span>
          <select className="inp" value={kind} onChange={(e) => setKind(e.target.value as PrivacyKind)}>
            {PRIVACY_KINDS.map((k) => (
              <option key={k} value={k}>
                {p.kinds[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span className="lbl">{n.email}</span>
          <input className="inp" type="email" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </label>
        <label className="fld">
          <span className="lbl">{n.phone}</span>
          <input className="inp" type="tel" value={phone} maxLength={20} placeholder={n.phonePlaceholder} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
          <span className="muted small">{n.contactHint}</span>
        </label>
        <div className="fld">
          <span className="lbl">{n.business}</span>
          {business ? (
            <p>
              {n.chosen(business.name)}{' '}
              <button type="button" className="linkish" onClick={() => setBusiness(null)}>
                {n.change}
              </button>
            </p>
          ) : (
            <>
              <input className="inp" value={search} placeholder={n.businessPlaceholder} onChange={(e) => setSearch(e.target.value)} />
              {found.length > 0 && (
                <ul className="support-list">
                  {found.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        className="support-item"
                        onClick={() => {
                          setBusiness(b);
                          setSearch('');
                        }}
                      >
                        {b.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <span className="muted small">{n.businessHint}</span>
        </div>
        <label className="fld">
          <span className="lbl">{n.received}</span>
          <input className="inp" type="date" value={receivedOn} max={today} onChange={(e) => setReceivedOn(e.target.value)} />
          <span className="muted small">{n.receivedHint}</span>
        </label>
        <label className="fld">
          <span className="lbl">{n.note}</span>
          <textarea className="inp" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="submit" className="btn" disabled={busy || !name.trim()}>
            {busy ? n.submitting : n.submit}
          </button>
          <button type="button" className="btn2" onClick={onCancel} disabled={busy}>
            {n.cancel}
          </button>
        </div>
      </div>
    </form>
  );
}
