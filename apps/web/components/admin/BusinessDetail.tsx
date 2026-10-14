'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  adminReason,
  FREE_MONTH_OPTIONS,
  PAID_PLANS,
  PLAN_PRICES,
  type AdminBusinessDetail,
  type AuditEntry,
  type PaidPlan,
} from '@outletbooking/shared';
import {
  addNote,
  changePlan,
  extendTrial,
  getBusiness,
  giveFreeMonths,
  sendOwnerPasswordReset,
  setBookingPage,
  type Result,
} from '@/lib/admin-api';
import {
  addMonthsMalaysia,
  daysUntil,
  formatDate,
  formatDateTime,
  formatDay,
  formatPhone,
  whatsappLink,
  ymdInMalaysia,
} from '@/lib/admin-format';
import { APP_URL } from '@/lib/config';
import { s } from '@/strings/en';
import { useAdmin } from './AdminShell';
import { endDate, isFree, planName } from './status';

const t = s.admin;
const d = t.business;
const DAY_MS = 86_400_000;
const EXTEND_DAYS = [7, 14, 30] as const;
type PlanTab = keyof typeof d.planActions.tabs;

type State = { kind: 'loading' } | { kind: 'ok'; biz: AdminBusinessDetail } | { kind: 'not_found' } | { kind: 'error' };
/** Error to show, or null when saved. */
type Save = (r: Result<AdminBusinessDetail>) => string | null;

/** I2 · Business detail: plan & usage, extend trial, booking page switch, owner, notes, audit log. */
export function BusinessDetail({ id }: { id: number }) {
  const { signedOut } = useAdmin();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getBusiness(id).then((r) => {
      if (!live) return;
      if (r.kind === 'ok') setState({ kind: 'ok', biz: r.data });
      else if (r.kind === 'signed_out') signedOut();
      else setState({ kind: r.kind === 'not_found' ? 'not_found' : 'error' });
    });
    return () => {
      live = false;
    };
  }, [id, attempt, signedOut]);

  // From I1's "Extend trial": scroll to the form once it is on the page.
  useEffect(() => {
    if (state.kind === 'ok' && window.location.hash === '#extend') document.getElementById('extend')?.scrollIntoView();
  }, [state.kind]);

  /** Apply a change's result: the API returns the updated business. */
  const save: Save = (r) => {
    if (r.kind === 'ok') {
      setState({ kind: 'ok', biz: r.data });
      return null;
    }
    if (r.kind === 'signed_out') {
      signedOut();
      return null;
    }
    return r.kind === 'refused' ? r.message : d.saveError;
  };

  const back = (
    <Link className="back-link" href="/admin">
      ← {d.back}
    </Link>
  );

  if (state.kind === 'loading') return <div className="admin-page">{back}<p className="muted">{t.loading}</p></div>;
  if (state.kind === 'not_found' || state.kind === 'error') {
    return (
      <div className="admin-page">
        {back}
        <div className="card admin-card">
          <p className="alert alert-error" role="alert">
            {state.kind === 'not_found' ? d.notFound : t.loadError}
          </p>
          {state.kind === 'error' && (
            <button type="button" className="btn2" onClick={() => setAttempt((n) => n + 1)}>
              {t.retry}
            </button>
          )}
        </div>
      </div>
    );
  }

  const { biz } = state;
  const whatsapp = biz.whatsappPhone ?? biz.owner?.phone ?? biz.phone;
  const bookingUrl = APP_URL ? `${APP_URL}/book/${biz.slug}` : null;
  const notes = biz.auditLog.filter((e) => e.action === 'note');
  const history = biz.auditLog.filter((e) => e.action !== 'note');

  return (
    <div className="admin-page">
      {back}
      <header className="biz-head">
        <span className="avatar avatar-lg" aria-hidden="true">
          {biz.name.slice(0, 2).toUpperCase()}
        </span>
        <div className="biz-head-text">
          <h1>{biz.name}</h1>
          <p className="muted">
            {s.contact.businessTypes[biz.template]} ·{' '}
            {bookingUrl ? (
              <a href={bookingUrl} target="_blank" rel="noopener noreferrer">
                /book/{biz.slug}
              </a>
            ) : (
              `/book/${biz.slug}`
            )}{' '}
            · {d.joined(formatDate(biz.createdAt))}
          </p>
        </div>
        <HeaderState biz={biz} />
        {whatsapp && (
          <a className="btn2" href={whatsappLink(whatsapp, d.whatsappText(biz.owner?.name ?? biz.name))} target="_blank" rel="noopener noreferrer">
            {d.whatsapp}
          </a>
        )}
      </header>

      {flash && (
        <p className="alert alert-ok" role="status">
          {flash}
        </p>
      )}

      <div className="biz-grid">
        <div className="biz-col">
          <Usage biz={biz} save={save} />
          <PlanActions biz={biz} save={save} onDone={setFlash} />
        </div>
        <div className="biz-col">
          <OwnerStaff biz={biz} save={save} onDone={setFlash} />
          <section className="card admin-section">
            <h2>{d.notes.title}</h2>
            {notes.length === 0 ? <p className="muted">{d.notes.empty}</p> : <EntryList entries={notes} />}
            <ReasonForm
              label={d.notes.label}
              placeholder=""
              submit={d.notes.submit}
              onSubmit={async (reason) => save(await addNote(biz.id, reason))}
            />
          </section>

          <section className="card admin-section">
            <h2>{d.audit.title}</h2>
            {history.length === 0 ? <p className="muted">{d.audit.empty}</p> : <EntryList entries={history} withAction />}
          </section>
        </div>
      </div>
    </div>
  );
}

function HeaderState({ biz }: { biz: AdminBusinessDetail }) {
  const end = endDate(biz);
  const h = d.headerState;
  const label =
    biz.state === 'trial'
      ? h.trial(end ? daysUntil(end) : 0)
      : biz.state === 'pilot'
        ? h.pilot(end ? formatDay(end) : '')
        : biz.state === 'paying'
          ? h.paying(planName(biz.subscription?.plan))
          : h.ended;
  const cls = biz.state === 'paying' ? 'tag' : biz.state === 'ended' ? 'tag tag-gray' : biz.state === 'pilot' ? 'tag tag-pend' : 'tag tag-blue';
  return <span className={cls}>{label}</span>;
}

function Usage({ biz, save }: { biz: AdminBusinessDetail; save: Save }) {
  const [changing, setChanging] = useState(false);
  const u = d.usage;
  const end = endDate(biz);
  const plan = biz.subscription?.plan ?? 'trial';
  // A trial has the Business plan's limits (docs/PRD.md).
  const limitPlan = plan === 'starter' ? 'starter' : 'business';
  const limit = PLAN_PRICES[limitPlan].resourceLimit;
  const when =
    end &&
    (biz.state === 'paying'
      ? isFree(biz)
        ? u.freeUntil(formatDay(end))
        : u.renews(formatDay(end))
      : biz.state === 'ended'
        ? u.ended(formatDay(end))
        : u.trialEnds(formatDay(end)));

  return (
    <section className="card admin-section">
      <h2>{u.title}</h2>
      <dl className="facts-list">
        <Fact label={u.plan}>
          {planName(plan)}
          {when && <span className="muted"> · {when}</span>}
        </Fact>
        <Fact label={u.resources(biz.resourceLabel)}>
          {u.ofLimit(biz.resourceCount, limit)} <span className="muted small">{u.limitNote(planName(limitPlan))}</span>
        </Fact>
        <Fact label={u.staff}>{d.owner.staff(biz.staffCount)}</Fact>
        <Fact label={u.bookings}>{biz.bookings30d}</Fact>
        <Fact label={u.toyyibpay}>
          <span className={biz.toyyibpayConnected ? 'tag' : 'tag tag-gray'}>{biz.toyyibpayConnected ? u.connected : u.notConnected}</span>
        </Fact>
        <Fact label={u.bookingPage}>
          <span className={biz.bookingEnabled ? 'tag' : 'tag tag-red'}>{biz.bookingEnabled ? u.live : u.paused}</span>{' '}
          {!changing && (
            <button type="button" className="link-button inline" onClick={() => setChanging(true)}>
              {biz.bookingEnabled ? d.page.pause : d.page.resume}
            </button>
          )}
        </Fact>
      </dl>
      {changing && (
        <div className="sub-form">
          {biz.bookingEnabled && <p className="muted small">{d.page.pauseHint}</p>}
          <ReasonForm
            label={d.reason}
            submit={biz.bookingEnabled ? d.page.confirmPause : d.page.confirmResume}
            danger={biz.bookingEnabled}
            onCancel={() => setChanging(false)}
            onSubmit={async (reason) => {
              const error = save(await setBookingPage(biz.id, { enabled: !biz.bookingEnabled, reason }));
              if (!error) setChanging(false);
              return error;
            }}
          />
        </div>
      )}
      <p className="muted small">{u.keysNote}</p>
    </section>
  );
}

/** I2 "Extend trial or change plan": three tabs, one form each. Paying businesses start on "Give free months". */
function PlanActions({ biz, save, onDone }: { biz: AdminBusinessDetail; save: Save; onDone: (message: string) => void }) {
  const paying = biz.state === 'paying';
  const [tab, setTab] = useState<PlanTab>(paying ? 'free' : 'extend');
  const a = d.planActions;
  return (
    <section id="extend" className="card admin-section">
      <h2>{a.title}</h2>
      <div className="chips" role="tablist" aria-label={a.title}>
        {(Object.keys(a.tabs) as PlanTab[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`chip${tab === key ? ' on' : ''}`}
            onClick={() => setTab(key)}
          >
            {a.tabs[key]}
          </button>
        ))}
      </div>
      {tab === 'extend' && <ExtendTrialForm biz={biz} save={save} onDone={onDone} />}
      {tab === 'free' && <FreeMonthsForm biz={biz} save={save} onDone={onDone} />}
      {tab === 'change' && <ChangePlanForm biz={biz} save={save} onDone={onDone} />}
    </section>
  );
}

type FormProps = { biz: AdminBusinessDetail; save: Save; onDone: (message: string) => void };

function ExtendTrialForm({ biz, save, onDone }: FormProps) {
  const [choice, setChoice] = useState<number | 'pick'>(14);
  const [until, setUntil] = useState('');
  const e = d.extend;
  const sub = biz.subscription;

  if (biz.state === 'paying' || !sub) return <p className="muted">{e.paying}</p>;

  // The API adds days to the later of now and the current trial end.
  const base = Math.max(Date.now(), Date.parse(sub.trialEndsAt));
  const minDay = ymdInMalaysia(new Date(base + DAY_MS));
  const newEnd =
    choice === 'pick' ? (until ? `${until}T12:00:00+08:00` : null) : new Date(base + choice * DAY_MS).toISOString();

  return (
    <>
      <div className="chips" role="group" aria-label={e.title}>
        {EXTEND_DAYS.map((n) => (
          <button key={n} type="button" className={`chip${choice === n ? ' on' : ''}`} aria-pressed={choice === n} onClick={() => setChoice(n)}>
            {e.days(n)}
          </button>
        ))}
        <button type="button" className={`chip${choice === 'pick' ? ' on' : ''}`} aria-pressed={choice === 'pick'} onClick={() => setChoice('pick')}>
          {e.pick}
        </button>
      </div>
      {choice === 'pick' && (
        <label className="fld">
          <span className="lbl">{e.lastDay}</span>
          <input className="inp" type="date" min={minDay} value={until} onChange={(ev) => setUntil(ev.target.value)} />
        </label>
      )}
      {newEnd && <p className="muted">{e.preview(formatDay(newEnd))}</p>}
      <ReasonForm
        label={d.reason}
        submit={e.submit}
        disabled={!newEnd}
        onSubmit={async (reason) => {
          const r = await extendTrial(biz.id, choice === 'pick' ? { until, reason } : { days: choice, reason });
          const error = save(r);
          if (!error && r.kind === 'ok' && r.data.subscription) onDone(e.done(formatDay(r.data.subscription.trialEndsAt)));
          return error;
        }}
      />
    </>
  );
}

function FreeMonthsForm({ biz, save, onDone }: FormProps) {
  const paying = biz.state === 'paying';
  const current = biz.subscription?.plan;
  const [months, setMonths] = useState<number>(FREE_MONTH_OPTIONS[0]);
  const [plan, setPlan] = useState<PaidPlan>(current === 'starter' ? 'starter' : 'business');
  const f = d.free;
  // Same rule as the API: a paying business extends its period end; anyone else starts today.
  const from = paying ? (biz.subscription?.currentPeriodEnd ?? null) : new Date().toISOString();
  const until = from ? formatDay(addMonthsMalaysia(from, months)) : null;

  return (
    <>
      <div className="chips" role="group" aria-label={d.planActions.tabs.free}>
        {FREE_MONTH_OPTIONS.map((n) => (
          <button key={n} type="button" className={`chip${months === n ? ' on' : ''}`} aria-pressed={months === n} onClick={() => setMonths(n)}>
            {f.months(n)}
          </button>
        ))}
      </div>
      {paying ? (
        <p className="muted">
          {f.plan}: <strong>{planName(current)}</strong>
        </p>
      ) : (
        <>
          <PlanPicker label={f.plan} value={plan} onChange={setPlan} />
          <p className="muted small">{f.startsToday}</p>
        </>
      )}
      <p className="muted small">{f.note}</p>
      <ReasonForm
        label={d.reason}
        submit={until ? f.submit(months, until) : d.planActions.tabs.free}
        disabled={!until}
        onSubmit={async (reason) => {
          const r = await giveFreeMonths(biz.id, paying ? { months, reason } : { months, plan, reason });
          const error = save(r);
          if (!error && r.kind === 'ok' && r.data.subscription?.freeUntil) onDone(f.done(formatDay(r.data.subscription.freeUntil)));
          return error;
        }}
      />
    </>
  );
}

function ChangePlanForm({ biz, save, onDone }: FormProps) {
  const current = biz.subscription?.plan;
  const [picked, setPlan] = useState<PaidPlan>(current === 'starter' ? 'business' : 'starter');
  // After a change the business is on the picked plan; offer the other one again.
  const plan: PaidPlan = picked === current ? (current === 'starter' ? 'business' : 'starter') : picked;
  const c = d.change;
  if (biz.state !== 'paying') return <p className="muted">{c.notPaying}</p>;
  const starterLimit = PLAN_PRICES.starter.resourceLimit;

  return (
    <>
      <p className="muted">
        {c.current}: <strong>{planName(current)}</strong>
      </p>
      <PlanPicker label={c.to} value={plan} onChange={setPlan} disabled={current} />
      {plan === 'starter' && biz.resourceCount > starterLimit && (
        <p className="alert alert-warn">{c.overLimit(biz.resourceCount, starterLimit, biz.resourceLabel)}</p>
      )}
      <p className="muted small">{c.note}</p>
      <ReasonForm
        label={d.reason}
        submit={c.submit}
        disabled={plan === current}
        onSubmit={async (reason) => {
          const r = await changePlan(biz.id, { plan, reason });
          const error = save(r);
          if (!error) onDone(c.done(planName(plan)));
          return error;
        }}
      />
    </>
  );
}

function PlanPicker({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: PaidPlan;
  onChange: (plan: PaidPlan) => void;
  /** The plan the business is already on (cannot be picked). */
  disabled?: string;
}) {
  return (
    <fieldset className="fld plain-fieldset">
      <legend className="lbl">{label}</legend>
      <div className="chips">
        {PAID_PLANS.map((p) => (
          <button
            key={p}
            type="button"
            className={`chip${value === p ? ' on' : ''}`}
            aria-pressed={value === p}
            disabled={p === disabled}
            onClick={() => onChange(p)}
          >
            {planName(p)} · {PLAN_PRICES[p].resourceLimit}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** I2 "Owner & staff": who is in the business, open invitations, and the owner's reset link. */
function OwnerStaff({ biz, save, onDone }: FormProps) {
  const [resetting, setResetting] = useState(false);
  const o = d.owner;
  const perms = (m: AdminBusinessDetail['members'][number]) =>
    m.role === 'owner'
      ? []
      : [m.canViewAll && o.perms.viewAll, m.canTakePayments && o.perms.payments, m.canEditSetup && o.perms.setup].filter(
          (x): x is string => !!x,
        );

  return (
    <section className="card admin-section">
      <h2>{o.title}</h2>
      {biz.owner ? (
        <dl className="facts-list">
          <Fact label={o.email}>
            <a href={`mailto:${biz.owner.email}`}>{biz.owner.email}</a>
          </Fact>
          <Fact label={o.mobile}>{biz.owner.phone ? formatPhone(biz.owner.phone) : '—'}</Fact>
        </dl>
      ) : (
        <p className="muted">{o.none}</p>
      )}

      <ul className="entries">
        {biz.members.map((m) => (
          <li key={m.email} className={m.isActive ? undefined : 'muted'}>
            <div className="entry-title">{m.name}</div>
            <div className="muted small">
              {[
                o.roles[m.role],
                m.role === 'owner' ? (m.emailVerified ? o.confirmed : o.unconfirmed) : m.email,
                ...perms(m),
                !m.isActive && o.inactive,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
            <div className="muted small">{o.joined(formatDate(m.joinedAt))}</div>
          </li>
        ))}
        {biz.invitations.map((i) => (
          <li key={i.email}>
            <div className="entry-title">{i.email}</div>
            <div className="muted small">
              {o.roles.staff} · {i.expired ? o.inviteExpired : o.invited}
            </div>
          </li>
        ))}
      </ul>

      {biz.owner &&
        (resetting ? (
          <div className="sub-form">
            <p className="muted small">{o.resetHint}</p>
            <ReasonForm
              label={d.reason}
              submit={o.resetSubmit}
              onCancel={() => setResetting(false)}
              onSubmit={async (reason) => {
                const error = save(await sendOwnerPasswordReset(biz.id, reason));
                if (!error) {
                  setResetting(false);
                  onDone(o.resetDone(biz.owner!.email));
                }
                return error;
              }}
            />
          </div>
        ) : (
          <button type="button" className="btn2 btn-sm align-start" onClick={() => setResetting(true)}>
            {o.reset}
          </button>
        ))}
    </section>
  );
}

/**
 * Every admin change needs a reason (3–500 characters), saved in the audit log.
 * `onSubmit` returns an error to show, or null when it worked (the form then clears).
 */
function ReasonForm({
  label,
  placeholder = d.reasonPlaceholder,
  submit,
  danger,
  disabled,
  onSubmit,
  onCancel,
}: {
  label: string;
  placeholder?: string;
  submit: string;
  danger?: boolean;
  disabled?: boolean;
  onSubmit: (reason: string) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handle(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const parsed = adminReason.safeParse(reason);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? null);
      return;
    }
    setBusy(true);
    setError(null);
    const err = await onSubmit(parsed.data);
    setBusy(false);
    if (err) setError(err);
    else setReason('');
  }

  return (
    <form method="post" className="reason-form" onSubmit={handle} noValidate>
      <label className="fld">
        <span className="lbl">{label}</span>
        <textarea
          className="inp"
          rows={2}
          value={reason}
          placeholder={placeholder}
          maxLength={500}
          onChange={(ev) => setReason(ev.target.value)}
          aria-invalid={error ? true : undefined}
        />
      </label>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button className={danger ? 'btn btn-danger' : 'btn'} type="submit" disabled={busy || disabled}>
          {busy ? d.saving : submit}
        </button>
        {onCancel && (
          <button className="btn2" type="button" onClick={onCancel} disabled={busy}>
            {d.cancel}
          </button>
        )}
      </div>
    </form>
  );
}

function EntryList({ entries, withAction }: { entries: AuditEntry[]; withAction?: boolean }) {
  return (
    <ul className="entries">
      {entries.map((entry) => (
        <li key={entry.id}>
          {withAction && <div className="entry-title">{d.audit.actions[entry.action] ?? entry.action}</div>}
          <div>{withAction ? <span className="muted">“{entry.reason}”</span> : entry.reason}</div>
          <div className="muted small">{d.audit.by(entry.admin.name, formatDateTime(entry.createdAt))}</div>
        </li>
      ))}
    </ul>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
