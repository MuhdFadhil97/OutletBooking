'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  LEAD_STATUSES,
  SUPPORT_SOURCES,
  SUPPORT_TABS,
  type AdminUserOption,
  type LeadStatus,
  type SupportCaseDetail,
  type SupportCaseRow,
  type SupportLead,
  type SupportSource,
  type SupportStatus,
  type SupportSummary,
  type SupportTab,
} from '@outletbooking/shared';
import {
  addSupportNote,
  assignSupportCase,
  createSupportCase,
  getSupportCase,
  getSupportSummary,
  listAdmins,
  listBusinesses,
  listSupportCases,
  listSupportLeads,
  setLeadStatus,
  setSupportStatus,
  type Result,
} from '@/lib/admin-api';
import { formatDate, formatDateTime, timeAgo, whatsappLink } from '@/lib/admin-format';
import { s } from '@/strings/en';
import { useAdmin } from './AdminShell';

const t = s.admin;
const p = t.support;

type Selection = { type: 'case'; id: number } | { type: 'lead'; id: number } | { type: 'new' } | null;
type Items = { kind: 'cases'; rows: SupportCaseRow[] } | { kind: 'leads'; rows: SupportLead[] };
type ListState = { kind: 'loading' } | { kind: 'ok'; items: Items } | { kind: 'error' };

const STATUS_TAG: Record<SupportStatus, string> = { open: 'tag tag-blue', waiting: 'tag tag-pend', closed: 'tag tag-gray' };
const ago = (iso: string) => timeAgo(iso, p.ago);

/** I11 · Support: cases (notes for FTech staff) and website leads. Two panes: the list, and the one you picked. */
export function SupportPage() {
  const { signedOut } = useAdmin();
  const [tab, setTab] = useState<SupportTab>('open');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [summary, setSummary] = useState<SupportSummary | null>(null);
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [selected, setSelected] = useState<Selection>(null);
  const [version, setVersion] = useState(0);

  // Search as you type, a moment after the last key.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const refresh = useCallback(() => setVersion((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const [sum, items] = await Promise.all([
        getSupportSummary(),
        tab === 'leads'
          ? listSupportLeads(query).then((r): Result<Items> => (r.kind === 'ok' ? { kind: 'ok', data: { kind: 'leads', rows: r.data } } : r))
          : listSupportCases(tab, query).then((r): Result<Items> => (r.kind === 'ok' ? { kind: 'ok', data: { kind: 'cases', rows: r.data } } : r)),
      ]);
      if (!live) return;
      if (sum.kind === 'signed_out' || items.kind === 'signed_out') return signedOut();
      if (sum.kind === 'ok') setSummary(sum.data);
      setList(items.kind === 'ok' ? { kind: 'ok', items: items.data } : { kind: 'error' });
    };
    void load();
    return () => {
      live = false;
    };
  }, [tab, query, version, signedOut]);

  const count = (key: SupportTab) => (summary ? (key === 'leads' ? summary.leads : summary[key]) : null);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>{p.title}</h1>
          <p className="muted">{p.subtitle}</p>
        </div>
        <button type="button" className="btn" onClick={() => setSelected({ type: 'new' })}>
          {p.newCase}
        </button>
      </div>

      <div className="chips" role="group" aria-label={p.title}>
        {SUPPORT_TABS.map((key) => (
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
            {key !== 'closed' && count(key) !== null ? ` (${count(key)})` : ''}
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
          {list.kind === 'ok' && list.items.rows.length === 0 && (
            <p className="muted admin-empty">{query.trim() ? p.empty : p.emptyTab[tab]}</p>
          )}
          {list.kind === 'ok' && list.items.rows.length > 0 && (
            <ul className="support-list">
              {list.items.kind === 'cases'
                ? list.items.rows.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="support-item"
                        aria-current={selected?.type === 'case' && selected.id === c.id}
                        onClick={() => setSelected({ type: 'case', id: c.id })}
                      >
                        <span className="support-item-top">
                          <span>{c.title}</span>
                          <span className={STATUS_TAG[c.status]}>{p.status[c.status]}</span>
                        </span>
                        <span className="muted small">
                          {[c.business?.name, p.sources[c.source], ago(c.updatedAt)].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    </li>
                  ))
                : list.items.rows.map((l) => (
                    <li key={l.id}>
                      <button
                        type="button"
                        className="support-item"
                        aria-current={selected?.type === 'lead' && selected.id === l.id}
                        onClick={() => setSelected({ type: 'lead', id: l.id })}
                      >
                        <span className="support-item-top">
                          <span>{leadTitle(l)}</span>
                          <span className="tag tag-ok">{p.leadTag}</span>
                        </span>
                        <span className="muted small">
                          {[l.businessName ?? l.name, l.status === 'new' ? p.newLead : p.leadStatus[l.status], p.sources.website, ago(l.createdAt)].join(' · ')}
                        </span>
                      </button>
                    </li>
                  ))}
            </ul>
          )}
        </div>

        <div>
          {selected === null && <p className="card admin-empty muted">{p.pick}</p>}
          {selected?.type === 'new' && (
            <NewCase
              signedOut={signedOut}
              onCancel={() => setSelected(null)}
              onCreated={(id) => {
                setTab('open');
                setSelected({ type: 'case', id });
                refresh();
              }}
            />
          )}
          {selected?.type === 'case' && (
            <CaseDetail key={selected.id} id={selected.id} signedOut={signedOut} onChanged={refresh} />
          )}
          {selected?.type === 'lead' && (
            <LeadDetail
              key={selected.id}
              lead={list.kind === 'ok' && list.items.kind === 'leads' ? list.items.rows.find((l) => l.id === selected.id) : undefined}
              signedOut={signedOut}
              onChanged={refresh}
              onOpenCase={(id) => {
                setTab('open');
                setSelected({ type: 'case', id });
                refresh();
              }}
            />
          )}
        </div>
      </div>

      <p className="card admin-note small">{p.footnote}</p>
    </div>
  );
}

const leadTitle = (l: SupportLead) =>
  [p.leadReasons[l.reason], l.resourceCount ? `${l.resourceCount}` : null].filter(Boolean).join(' · ');

/** A failed call: the API's message, or the generic one. `signed_out` leaves the page. */
function problem(r: Result<unknown>, signedOut: () => void): string | null {
  if (r.kind === 'ok') return null;
  if (r.kind === 'signed_out') {
    signedOut();
    return null;
  }
  return r.kind === 'refused' ? r.message : t.business.saveError;
}

function CaseDetail({ id, signedOut, onChanged }: { id: number; signedOut: () => void; onChanged: () => void }) {
  const c = p.case;
  const [detail, setDetail] = useState<SupportCaseDetail | null>(null);
  const [admins, setAdmins] = useState<AdminUserOption[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [fromOwner, setFromOwner] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([getSupportCase(id), listAdmins()]).then(([d, a]) => {
      if (!live) return;
      if (d.kind === 'signed_out') return signedOut();
      if (d.kind === 'ok') setDetail(d.data);
      else setFailed(true);
      if (a.kind === 'ok') setAdmins(a.data.filter((x) => x.isActive));
    });
    return () => {
      live = false;
    };
  }, [id, signedOut]);

  async function run(call: () => Promise<Result<SupportCaseDetail>>, after?: () => void) {
    setBusy(true);
    setError(null);
    const r = await call();
    setBusy(false);
    const err = problem(r, signedOut);
    if (err) return setError(err);
    if (r.kind === 'ok') {
      setDetail(r.data);
      after?.();
      onChanged();
    }
  }

  if (failed) return <p className="card admin-empty alert alert-error">{p.loadError}</p>;
  if (!detail) return <p className="card admin-empty muted">{t.loading}</p>;

  const info = detail.businessInfo;
  const submitNote = (ev: FormEvent) => {
    ev.preventDefault();
    if (!body.trim()) return;
    void run(
      () => addSupportNote(id, { body, kind: fromOwner ? 'owner_message' : 'internal' }),
      () => {
        setBody('');
        setFromOwner(false);
      },
    );
  };

  return (
    <section className="card admin-section" aria-labelledby="case-title">
      <div className="admin-page-head">
        <div>
          <h2 id="case-title">{detail.title}</h2>
          <p className="muted small">
            {[c.meta(detail.id), detail.business?.name, info?.ownerName, info?.phone, p.sources[detail.source]].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="actions">
          {info?.phone && (
            <a className="btn2 btn-sm" href={whatsappLink(info.phone)} target="_blank" rel="noopener noreferrer">
              {c.whatsapp}
            </a>
          )}
          {detail.business && (
            <Link className="btn2 btn-sm" href={`/admin/businesses/${detail.business.id}`}>
              {c.openBusiness}
            </Link>
          )}
        </div>
      </div>

      <div className="case-facts">
        <label className="fld">
          <span className="lbl">{c.assigned}</span>
          <select
            className="inp"
            value={detail.assignedTo?.id ?? ''}
            disabled={busy}
            onChange={(e) => void run(() => assignSupportCase(id, e.target.value ? Number(e.target.value) : null))}
          >
            <option value="">{c.nobody}</option>
            {admins.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <div className="fld">
          <span className="lbl">{c.status}</span>
          <div>
            <span className={STATUS_TAG[detail.status]}>{p.status[detail.status]}</span>
            {detail.closedAt && <span className="muted small"> {c.closedOn(formatDate(detail.closedAt))}</span>}
          </div>
        </div>
        {info?.trialEndsAt && (
          <div className="fld">
            <span className="lbl">{c.trialEnds}</span>
            <div>{formatDate(info.trialEndsAt)}</div>
          </div>
        )}
      </div>

      {detail.lead && (
        <p className="muted small">
          {c.fromLead}: {leadTitle(detail.lead)} · {detail.lead.name}
          {detail.lead.message ? ` — “${detail.lead.message}”` : ''}
        </p>
      )}

      <h3>{c.thread}</h3>
      {detail.notes.length === 0 ? (
        <p className="muted small">{c.noNotes}</p>
      ) : (
        <ul className="thread">
          {detail.notes.map((n) => (
            <li key={n.id} className={n.kind === 'owner_message' ? 'from-owner' : undefined}>
              <div className="thread-meta">
                {n.kind === 'owner_message' ? c.owner : c.internal(n.admin?.name ?? c.removedAdmin)} · {formatDateTime(n.createdAt)}
              </div>
              {n.body}
            </li>
          ))}
        </ul>
      )}

      <form method="post" className="fld-stack" style={{ maxWidth: 'none', marginTop: 16 }} onSubmit={submitNote} noValidate>
        <label className="fld">
          <span className="lbl">{c.addNote}</span>
          <textarea className="inp" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={fromOwner} onChange={(e) => setFromOwner(e.target.checked)} />
          {c.ownerMessage}
        </label>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="submit" className="btn" disabled={busy || !body.trim()}>
            {busy ? c.adding : c.add}
          </button>
          {detail.status !== 'waiting' && detail.status !== 'closed' && (
            <button type="button" className="btn2" disabled={busy} onClick={() => void run(() => setSupportStatus(id, 'waiting'))}>
              {c.waiting}
            </button>
          )}
          {detail.status === 'closed' ? (
            <button type="button" className="btn2" disabled={busy} onClick={() => void run(() => setSupportStatus(id, 'open'))}>
              {c.reopen}
            </button>
          ) : (
            <button type="button" className="btn2" disabled={busy} onClick={() => void run(() => setSupportStatus(id, 'closed'))}>
              {c.close}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function LeadDetail({
  lead,
  signedOut,
  onChanged,
  onOpenCase,
}: {
  lead: SupportLead | undefined;
  signedOut: () => void;
  onChanged: () => void;
  onOpenCase: (id: number) => void;
}) {
  const l = p.lead;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!lead) return <p className="card admin-empty muted">{p.pick}</p>;

  async function changeStatus(status: LeadStatus) {
    setBusy(true);
    setError(null);
    const r = await setLeadStatus(lead!.id, status);
    setBusy(false);
    const err = problem(r, signedOut);
    if (err) return setError(err);
    onChanged();
  }

  async function openCase() {
    setBusy(true);
    setError(null);
    const who = lead!.businessName ?? lead!.name;
    const r = await createSupportCase({
      title: l.caseTitle(p.leadReasons[lead!.reason], who),
      source: 'website',
      leadId: lead!.id,
      note: lead!.message ?? undefined,
      noteKind: 'owner_message',
    });
    setBusy(false);
    const err = problem(r, signedOut);
    if (err) return setError(err);
    if (r.kind === 'ok') onOpenCase(r.data.id);
  }

  const phone = lead.phone;
  return (
    <section className="card admin-section" aria-labelledby="lead-title">
      <div className="admin-page-head">
        <div>
          <h2 id="lead-title">
            {p.leadReasons[lead.reason]} · {lead.businessName ?? lead.name}
          </h2>
          <p className="muted small">
            {[p.sources.website, `${l.received} ${formatDateTime(lead.createdAt)}`].join(' · ')}
          </p>
        </div>
        <div className="actions">
          {phone && (
            <a className="btn2 btn-sm" href={whatsappLink(phone)} target="_blank" rel="noopener noreferrer">
              {l.whatsapp}
            </a>
          )}
          {lead.email && (
            <a className="btn2 btn-sm" href={`mailto:${lead.email}`}>
              {l.email}
            </a>
          )}
        </div>
      </div>

      <dl className="account-facts">
        <dt>{l.contact}</dt>
        <dd>{[lead.name, phone, lead.email].filter(Boolean).join(' · ')}</dd>
        {lead.businessName && (
          <>
            <dt>{l.business}</dt>
            <dd>{lead.businessName}</dd>
          </>
        )}
        {lead.businessType && (
          <>
            <dt>{l.type}</dt>
            <dd>{s.contact.businessTypes[lead.businessType as keyof typeof s.contact.businessTypes] ?? lead.businessType}</dd>
          </>
        )}
        {lead.resourceCount && (
          <>
            <dt>{l.resources}</dt>
            <dd>{lead.resourceCount}</dd>
          </>
        )}
        {lead.message && (
          <>
            <dt>{l.message}</dt>
            <dd style={{ whiteSpace: 'pre-wrap', fontWeight: 400 }}>{lead.message}</dd>
          </>
        )}
      </dl>
      <p className="muted small">{l.consent}</p>

      <div className="case-facts">
        <label className="fld">
          <span className="lbl">{l.status}</span>
          <select className="inp" value={lead.status} disabled={busy} onChange={(e) => void changeStatus(e.target.value as LeadStatus)}>
            {LEAD_STATUSES.map((st) => (
              <option key={st} value={st}>
                {p.leadStatus[st]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {lead.caseId !== null ? (
          <button type="button" className="btn2" onClick={() => onOpenCase(lead.caseId!)}>
            {l.goToCase(lead.caseId)}
          </button>
        ) : (
          <button type="button" className="btn" disabled={busy} onClick={() => void openCase()}>
            {l.openCase}
          </button>
        )}
      </div>
    </section>
  );
}

function NewCase({
  signedOut,
  onCancel,
  onCreated,
}: {
  signedOut: () => void;
  onCancel: () => void;
  onCreated: (id: number) => void;
}) {
  const n = p.create;
  const [title, setTitle] = useState('');
  const [source, setSource] = useState<SupportSource>('whatsapp');
  const [note, setNote] = useState('');
  const [fromOwner, setFromOwner] = useState(true);
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
    const r = await createSupportCase({
      title,
      source,
      businessId: business?.id,
      note: note.trim() || undefined,
      noteKind: fromOwner ? 'owner_message' : 'internal',
    });
    setBusy(false);
    const err = problem(r, signedOut);
    if (err) return setError(err);
    if (r.kind === 'ok') onCreated(r.data.id);
  }

  return (
    <form method="post" className="card admin-section" onSubmit={submit} noValidate aria-labelledby="new-case">
      <h2 id="new-case">{n.title}</h2>
      <div className="fld-stack" style={{ maxWidth: 'none' }}>
        <label className="fld">
          <span className="lbl">{n.caseTitle}</span>
          <input className="inp" value={title} maxLength={200} placeholder={n.titlePlaceholder} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <label className="fld">
          <span className="lbl">{n.source}</span>
          <select className="inp" value={source} onChange={(e) => setSource(e.target.value as SupportSource)}>
            {SUPPORT_SOURCES.map((src) => (
              <option key={src} value={src}>
                {p.sources[src]}
              </option>
            ))}
          </select>
        </label>
        <div className="fld">
          <span className="lbl">{n.business}</span>
          {business ? (
            <div className="actions">
              <span>{n.chosen(business.name)}</span>
              <button type="button" className="btn2 btn-sm" onClick={() => setBusiness(null)}>
                {n.change}
              </button>
            </div>
          ) : (
            <>
              <input
                className="inp"
                type="search"
                value={search}
                placeholder={n.businessPlaceholder}
                onChange={(e) => setSearch(e.target.value)}
              />
              {found.length > 0 && (
                <ul className="support-list card">
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
        </div>
        <label className="fld">
          <span className="lbl">{n.note}</span>
          <textarea className="inp" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {note.trim() && (
          <label className="check">
            <input type="checkbox" checked={fromOwner} onChange={(e) => setFromOwner(e.target.checked)} />
            {n.noteOwner}
          </label>
        )}
      </div>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="btn" disabled={busy || title.trim().length < 3}>
          {busy ? n.submitting : n.submit}
        </button>
        <button type="button" className="btn2" onClick={onCancel} disabled={busy}>
          {n.cancel}
        </button>
      </div>
    </form>
  );
}
