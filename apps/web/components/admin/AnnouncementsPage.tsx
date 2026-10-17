'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_CHANNELS,
  ANNOUNCEMENT_PLANS,
  ANNOUNCEMENT_TITLE_MAX,
  ANNOUNCEMENT_TYPES,
  BUSINESS_TEMPLATES,
  type AnnouncementAudience,
  type AnnouncementChannel,
  type AnnouncementRow,
  type AnnouncementType,
} from '@outletbooking/shared';
import {
  cancelAnnouncement,
  countAnnouncementAudience,
  createAnnouncement,
  listAnnouncements,
  sendTestAnnouncement,
  type Result,
} from '@/lib/admin-api';
import { formatDate, formatDateTime } from '@/lib/admin-format';
import { malaysiaLocalToIso } from '@/lib/announcement-format';
import { s } from '@/strings/en';
import { useAdmin } from './AdminShell';

const t = s.admin;
const p = t.announcements;
const f = p.form;

type ListState = { kind: 'loading' } | { kind: 'ok'; rows: AnnouncementRow[] } | { kind: 'error' };

/** A failed call: the API's message, or the generic one. `signed_out` leaves the page. */
function problem(r: Result<unknown>, signedOut: () => void): string | null {
  if (r.kind === 'ok') return null;
  if (r.kind === 'signed_out') {
    signedOut();
    return null;
  }
  return r.kind === 'refused' ? r.message : f.error;
}

/** Who a history row went to, in words. */
function audienceLabel(a: Pick<AnnouncementRow, 'audience' | 'audienceValue'>): string {
  if (a.audience === 'all') return f.audiences.all;
  if (a.audience === 'plan') return `${f.plans[a.audienceValue as keyof typeof f.plans] ?? a.audienceValue} ${f.audiences.plan.toLowerCase().replace('by ', '')}`;
  if (a.audience === 'template') return f.templates[a.audienceValue as keyof typeof f.templates] ?? a.audienceValue ?? '';
  return a.audienceValue ?? '';
}

/** I28 · Announcements to owners: write one, see the banner, send now or schedule, and the history. Super admins only. */
export function AnnouncementsPage() {
  const { admin, signedOut } = useAdmin();
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const refresh = useCallback(() => {
    void listAnnouncements().then((r) => {
      if (r.kind === 'signed_out') return signedOut();
      setList(r.kind === 'ok' ? { kind: 'ok', rows: r.data } : { kind: 'error' });
    });
  }, [signedOut]);

  useEffect(() => {
    if (admin.role === 'super_admin') refresh();
  }, [admin.role, refresh]);

  if (admin.role !== 'super_admin') {
    return (
      <div className="admin-page">
        <h1>{p.title}</h1>
        <p className="card admin-empty muted">{p.superOnly}</p>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>{p.title}</h1>
          <p className="muted">{p.subtitle}</p>
        </div>
      </div>
      <div className="support-grid">
        <NewAnnouncement signedOut={signedOut} onSent={refresh} />
        <History list={list} onChanged={refresh} onRetry={refresh} signedOut={signedOut} />
      </div>
    </div>
  );
}

function NewAnnouncement({ signedOut, onSent }: { signedOut: () => void; onSent: () => void }) {
  const [type, setType] = useState<AnnouncementType>('maintenance');
  const [audience, setAudience] = useState<AnnouncementAudience>('all');
  const [value, setValue] = useState('');
  const [channels, setChannels] = useState<AnnouncementChannel[]>(['email', 'in_app']);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [later, setLater] = useState(false);
  const [sendOn, setSendOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [owners, setOwners] = useState<number | null>(null);
  const [busy, setBusy] = useState<'send' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // "Send now · 23 owners": how many owners this audience reaches today.
  useEffect(() => {
    if (audience !== 'all' && !value.trim()) {
      setOwners(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void countAnnouncementAudience(audience, value).then((r) => {
        if (live) setOwners(r.kind === 'ok' ? r.data.owners : null);
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [audience, value]);

  const toggle = (c: AnnouncementChannel) => setChannels((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  const showsBanner = channels.includes('in_app');

  const payload = () => {
    const sendAt = later && sendOn ? malaysiaLocalToIso(sendOn) : undefined;
    const endsAt = showsBanner && endsOn ? malaysiaLocalToIso(endsOn) : undefined;
    return {
      type,
      audience,
      ...(audience !== 'all' ? { audienceValue: value.trim() } : {}),
      channels,
      title,
      body,
      ...(sendAt ? { sendAt } : {}),
      ...(endsAt ? { endsAt } : {}),
    };
  };

  function check(): string | null {
    if (title.trim().length < 3 || body.trim().length < 3) return f.fillIn;
    if (later && (!sendOn || Date.parse(malaysiaLocalToIso(sendOn)) <= Date.now())) return f.pastTime;
    return null;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const bad = check();
    setDone(null);
    if (bad) return setError(bad);
    setBusy('send');
    setError(null);
    const r = await createAnnouncement(payload());
    setBusy(null);
    const err = problem(r, signedOut);
    if (err) return setError(err);
    if (r.kind === 'ok') {
      setDone(r.data.status === 'scheduled' ? f.scheduled : f.sent(r.data.sentCount));
      setTitle('');
      setBody('');
      setEndsOn('');
      setSendOn('');
      setLater(false);
      onSent();
    }
  }

  async function test() {
    const bad = title.trim().length < 3 || body.trim().length < 3 ? f.fillIn : null;
    setDone(null);
    if (bad) return setError(bad);
    setBusy('test');
    setError(null);
    const r = await sendTestAnnouncement(payload());
    setBusy(null);
    const err = problem(r, signedOut);
    if (err) return setError(err);
    if (r.kind === 'ok') setDone(f.testSent(r.data.sentTo));
  }

  return (
    <form method="post" className="card admin-section" onSubmit={submit} noValidate aria-labelledby="new-announcement">
      <h2 id="new-announcement">{f.title}</h2>
      <div className="fld-stack" style={{ maxWidth: 'none' }}>
        <label className="fld">
          <span className="lbl">{f.type}</span>
          <select className="inp" value={type} onChange={(e) => setType(e.target.value as AnnouncementType)}>
            {ANNOUNCEMENT_TYPES.map((k) => (
              <option key={k} value={k}>
                {f.types[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="fld">
          <span className="lbl">{f.audience}</span>
          <select
            className="inp"
            value={audience}
            onChange={(e) => {
              setAudience(e.target.value as AnnouncementAudience);
              setValue('');
            }}
          >
            {ANNOUNCEMENT_AUDIENCES.map((k) => (
              <option key={k} value={k}>
                {f.audiences[k]}
              </option>
            ))}
          </select>
        </label>
        {audience === 'plan' && (
          <select className="inp" aria-label={f.audiences.plan} value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">{f.pickValue}</option>
            {ANNOUNCEMENT_PLANS.map((k) => (
              <option key={k} value={k}>
                {f.plans[k]}
              </option>
            ))}
          </select>
        )}
        {audience === 'template' && (
          <select className="inp" aria-label={f.audiences.template} value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">{f.pickValue}</option>
            {BUSINESS_TEMPLATES.map((k) => (
              <option key={k} value={k}>
                {f.templates[k]}
              </option>
            ))}
          </select>
        )}
        {audience === 'business' && (
          <label className="fld">
            <span className="lbl">{f.businessLink}</span>
            <input className="inp" value={value} placeholder={f.businessPlaceholder} onChange={(e) => setValue(e.target.value)} autoCapitalize="none" />
          </label>
        )}

        <fieldset className="fld" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="lbl">{f.how}</legend>
          {ANNOUNCEMENT_CHANNELS.map((c) => (
            <label key={c} className="check">
              <input type="checkbox" checked={channels.includes(c)} onChange={() => toggle(c)} />
              {f.channels[c]}
            </label>
          ))}
        </fieldset>

        <label className="fld">
          <span className="lbl">{f.titleLabel}</span>
          <input className="inp" value={title} maxLength={ANNOUNCEMENT_TITLE_MAX} placeholder={f.titlePlaceholder} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="fld">
          <span className="lbl">{f.message}</span>
          <textarea className="inp" rows={4} maxLength={ANNOUNCEMENT_BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>

        <div className="fld">
          <span className="lbl">{f.when}</span>
          <div className="chips" role="group" aria-label={f.when}>
            <button type="button" className={`chip${!later ? ' on' : ''}`} aria-pressed={!later} onClick={() => setLater(false)}>
              {f.now}
            </button>
            <button type="button" className={`chip${later ? ' on' : ''}`} aria-pressed={later} onClick={() => setLater(true)}>
              {f.schedule}
            </button>
          </div>
        </div>
        {later && (
          <label className="fld">
            <span className="lbl">{f.sendOn}</span>
            <input className="inp" type="datetime-local" value={sendOn} onChange={(e) => setSendOn(e.target.value)} />
          </label>
        )}
        {showsBanner && (
          <label className="fld">
            <span className="lbl">{f.endsOn}</span>
            <input className="inp" type="datetime-local" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            <span className="muted small">{f.endsHint}</span>
          </label>
        )}

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
        <div className="actions">
          <button type="button" className="btn2" disabled={busy !== null || channels.length === 0} onClick={() => void test()}>
            {busy === 'test' ? f.testing : f.test}
          </button>
          <button type="submit" className="btn" disabled={busy !== null || channels.length === 0}>
            {busy === 'send' ? f.sending : later ? f.scheduleBtn(owners) : f.sendNow(owners)}
          </button>
        </div>
        <p className="muted small">{f.rule}</p>

        {showsBanner && (
          <div className="fld">
            <span className="lbl">{p.preview.title}</span>
            <div className="card admin-note" style={{ background: '#E0ECFB' }}>
              <strong>{title.trim() || p.preview.empty}</strong>
              {body.trim() && <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{body}</p>}
              <p className="small" style={{ textAlign: 'right', margin: '8px 0 0', fontWeight: 700 }}>
                {p.preview.dismiss}
              </p>
            </div>
            <span className="muted small">{p.preview.note}</span>
          </div>
        )}
      </div>
    </form>
  );
}

function History({
  list,
  onChanged,
  onRetry,
  signedOut,
}: {
  list: ListState;
  onChanged: () => void;
  onRetry: () => void;
  signedOut: () => void;
}) {
  const h = p.history;
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cancel(id: number) {
    if (!window.confirm(h.cancelConfirm)) return;
    setBusyId(id);
    setError(null);
    const r = await cancelAnnouncement(id);
    setBusyId(null);
    const err = problem(r, signedOut);
    if (err) return setError(err);
    onChanged();
  }

  return (
    <section className="card table-card" aria-labelledby="announcement-history">
      <h2 id="announcement-history" className="admin-section">
        {h.title}
      </h2>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {list.kind === 'loading' && <p className="muted admin-empty">{t.loading}</p>}
      {list.kind === 'error' && (
        <div className="admin-empty">
          <p className="alert alert-error" role="alert">
            {h.loadError}
          </p>
          <button type="button" className="btn2" onClick={onRetry}>
            {t.retry}
          </button>
        </div>
      )}
      {list.kind === 'ok' && list.rows.length === 0 && <p className="muted admin-empty">{h.empty}</p>}
      {list.kind === 'ok' && list.rows.length > 0 && (
        <ul className="support-list">
          {list.rows.map((a) => (
            <li key={a.id} className="support-item" style={{ cursor: 'default' }}>
              <span className="support-item-top">
                <span>{a.title}</span>
                <span className={a.status === 'scheduled' ? 'tag tag-pend' : a.status === 'ended' ? 'tag tag-gray' : 'tag tag-ok'}>
                  {a.status === 'scheduled' ? h.scheduledFor(formatDateTime(a.sendAt)) : a.status === 'ended' ? h.ended : h.sentTo(a.sentCount)}
                </span>
              </span>
              <span className="muted small">
                {[a.sentAt ? formatDate(a.sentAt) : null, audienceLabel(a), a.channels.map((c) => f.channels[c]).join(', ')].filter(Boolean).join(' · ')}
              </span>
              {a.status === 'scheduled' && (
                <span>
                  <button type="button" className="btn2 btn-sm" disabled={busyId === a.id} onClick={() => void cancel(a.id)}>
                    {busyId === a.id ? h.cancelling : h.cancel}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
