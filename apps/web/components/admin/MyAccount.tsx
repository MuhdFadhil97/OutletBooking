'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  ADMIN_PASSWORD_MIN_LENGTH,
  changeAdminPasswordSchema,
  type AdminAccount,
  type AdminDevice,
} from '@outletbooking/shared';
import {
  changePassword,
  confirmMovePhone,
  getAccount,
  makeNewBackupCodes,
  signOutDevice,
  signOutOtherDevices,
  startMovePhone,
  type Result,
} from '@/lib/admin-api';
import { setupKeyOf } from '@/lib/admin-auth';
import { formatDateTime } from '@/lib/admin-format';
import { s } from '@/strings/en';
import { useAdmin } from './AdminShell';
import { BackupCodes } from './BackupCodes';
import { SetupQr } from './SetupQr';

const t = s.admin;
const a = t.account;

type State = { kind: 'loading' } | { kind: 'ok'; account: AdminAccount } | { kind: 'error' };

/** I29 · My account: profile, password, two-step (backup codes, new phone) and signed-in devices. Every admin. */
export function MyAccount() {
  const { signedOut } = useAdmin();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void getAccount().then((r) => {
      if (!live) return;
      if (r.kind === 'ok') setState({ kind: 'ok', account: r.data });
      else if (r.kind === 'signed_out') signedOut();
      else setState({ kind: 'error' });
    });
    return () => {
      live = false;
    };
  }, [attempt, signedOut]);

  const reload = () => setAttempt((n) => n + 1);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>{a.title}</h1>
          <p className="muted">{a.subtitle}</p>
        </div>
      </div>

      {state.kind === 'loading' && <p className="muted">{t.loading}</p>}
      {state.kind === 'error' && (
        <div className="card admin-card">
          <p className="alert alert-error" role="alert">
            {a.loadError}
          </p>
          <button type="button" className="btn2" onClick={reload}>
            {t.retry}
          </button>
        </div>
      )}
      {state.kind === 'ok' && (
        <div className="account-grid">
          <ProfileCard account={state.account} />
          <PasswordCard signedOut={signedOut} onChanged={reload} />
          <TwoFactorCard account={state.account} signedOut={signedOut} onChanged={reload} />
          <DevicesCard devices={state.account.devices} signedOut={signedOut} onChanged={reload} />
        </div>
      )}
    </div>
  );
}

/** What a failed call shows: the API's own message, or the generic one. `signed_out` leaves the page. */
function problem(r: Result<unknown>, signedOut: () => void): string | null {
  if (r.kind === 'ok') return null;
  if (r.kind === 'signed_out') {
    signedOut();
    return null;
  }
  return r.kind === 'refused' ? r.message : t.business.saveError;
}

function ProfileCard({ account }: { account: AdminAccount }) {
  return (
    <section className="card admin-section" aria-labelledby="acct-profile">
      <h2 id="acct-profile">{a.profile.title}</h2>
      <dl className="account-facts">
        <dt>{a.profile.name}</dt>
        <dd>{account.name}</dd>
        <dt>{a.profile.email}</dt>
        <dd>{account.email}</dd>
        <dt>{a.profile.role}</dt>
        <dd>{t.roles[account.role]}</dd>
      </dl>
      <p className="muted small">{a.profile.note}</p>
    </section>
  );
}

function PasswordCard({ signedOut, onChanged }: { signedOut: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const data = new FormData(form);
    const next = String(data.get('next') ?? '');
    setDone(null);
    if (next !== String(data.get('confirm') ?? '')) return setError(a.password.mismatch);
    const parsed = changeAdminPasswordSchema.safeParse({ currentPassword: data.get('current'), newPassword: next });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? t.business.saveError);

    setBusy(true);
    setError(null);
    const r = await changePassword(parsed.data);
    setBusy(false);
    const err = problem(r, signedOut);
    if (err) return setError(err);
    if (r.kind === 'ok') {
      form.reset();
      setDone(a.password.done(r.data.signedOutDevices));
      onChanged();
    }
  }

  return (
    // method="post": a submit before JS loads must never put a password in the URL.
    <form method="post" className="card admin-section" aria-labelledby="acct-password" onSubmit={submit} noValidate>
      <h2 id="acct-password">{a.password.title}</h2>
      <div className="fld-stack">
        <label className="fld">
          <span className="lbl">{a.password.current}</span>
          <input className="inp" name="current" type="password" autoComplete="current-password" />
        </label>
        <label className="fld">
          <span className="lbl">{a.password.next}</span>
          <input className="inp" name="next" type="password" autoComplete="new-password" minLength={ADMIN_PASSWORD_MIN_LENGTH} />
        </label>
        <label className="fld">
          <span className="lbl">{a.password.confirm}</span>
          <input className="inp" name="confirm" type="password" autoComplete="new-password" />
        </label>
      </div>
      <p className="muted small">{a.password.hint}</p>
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
        <button className="btn" type="submit" disabled={busy}>
          {busy ? a.password.saving : a.password.submit}
        </button>
      </div>
    </form>
  );
}

type Panel =
  | { name: 'closed' }
  | { name: 'codes-password' }
  | { name: 'codes'; codes: string[] }
  | { name: 'move-password' }
  | { name: 'move-scan'; totpUri: string }
  | { name: 'move-done'; codes: string[] };

function TwoFactorCard({ account, signedOut, onChanged }: { account: AdminAccount; signedOut: () => void; onChanged: () => void }) {
  const tf = a.twoFactor;
  const [panel, setPanel] = useState<Panel>({ name: 'closed' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (next: Panel) => {
    setError(null);
    setPanel(next);
  };
  const low = account.backupCodesLeft <= 2;

  async function withPassword(ev: FormEvent<HTMLFormElement>, kind: 'codes' | 'move') {
    ev.preventDefault();
    const password = String(new FormData(ev.currentTarget).get('password') ?? '');
    if (!password) return setError(t.signIn.error);
    setBusy(true);
    setError(null);
    if (kind === 'codes') {
      const r = await makeNewBackupCodes(password);
      setBusy(false);
      const err = problem(r, signedOut);
      if (err) return setError(err);
      if (r.kind === 'ok') setPanel({ name: 'codes', codes: r.data.backupCodes });
    } else {
      const r = await startMovePhone(password);
      setBusy(false);
      const err = problem(r, signedOut);
      if (err) return setError(err);
      if (r.kind === 'ok') setPanel({ name: 'move-scan', totpUri: r.data.totpUri });
    }
  }

  async function confirm(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const code = String(new FormData(ev.currentTarget).get('code') ?? '').trim();
    setBusy(true);
    setError(null);
    const r = await confirmMovePhone(code);
    setBusy(false);
    const err = problem(r, signedOut);
    if (err) {
      // Too many wrong codes or timed out: back to the start.
      if (r.kind === 'refused' && r.message.toLowerCase().includes('start again')) setPanel({ name: 'move-password' });
      return setError(err);
    }
    if (r.kind === 'ok') {
      setPanel({ name: 'move-done', codes: r.data.backupCodes });
      onChanged();
    }
  }

  return (
    <section className="card admin-section" aria-labelledby="acct-2fa">
      <h2 id="acct-2fa">{tf.title}</h2>
      <dl className="account-facts">
        <dt>{tf.app}</dt>
        <dd>
          <span className={account.twoFactorEnabled ? 'tag' : 'tag tag-red'}>{account.twoFactorEnabled ? tf.on : tf.off}</span>
        </dd>
        <dt>{tf.codesLeft}</dt>
        <dd>
          {tf.codesOf(account.backupCodesLeft, account.backupCodesTotal)}
          {low && <span className="tag tag-pend"> {tf.low}</span>}
        </dd>
      </dl>
      <div className="actions">
        <button type="button" className="btn2" onClick={() => open({ name: 'codes-password' })} disabled={busy}>
          {tf.newCodes}
        </button>
        <button type="button" className="btn2" onClick={() => open({ name: 'move-password' })} disabled={busy}>
          {tf.moveToNewPhone}
        </button>
      </div>
      <p className="muted small">{tf.note}</p>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      {(panel.name === 'codes-password' || panel.name === 'move-password') && (
        <form
          method="post"
          className="panel"
          onSubmit={(ev) => void withPassword(ev, panel.name === 'codes-password' ? 'codes' : 'move')}
          noValidate
        >
          <h3>{panel.name === 'codes-password' ? tf.newCodes : tf.moveTitle}</h3>
          <label className="fld">
            <span className="lbl">{tf.passwordAgain}</span>
            <input className="inp" name="password" type="password" autoComplete="current-password" autoFocus />
          </label>
          <div className="actions">
            <button className="btn" type="submit" disabled={busy}>
              {busy ? tf.working : tf.continue}
            </button>
            <button className="btn2" type="button" onClick={() => open({ name: 'closed' })} disabled={busy}>
              {tf.cancel}
            </button>
          </div>
        </form>
      )}

      {panel.name === 'codes' && (
        <div className="panel">
          <h3>{tf.codesTitle}</h3>
          <p className="muted small">{tf.codesNote}</p>
          <BackupCodes codes={panel.codes} />
          <div className="actions">
            <button
              className="btn"
              type="button"
              onClick={() => {
                open({ name: 'closed' });
                onChanged();
              }}
            >
              {tf.codesDone}
            </button>
          </div>
        </div>
      )}

      {panel.name === 'move-scan' && (
        <form method="post" className="panel" onSubmit={confirm} noValidate>
          <h3>{tf.moveTitle}</h3>
          <p>{tf.moveStep1}</p>
          <SetupQr uri={panel.totpUri} alt={tf.qrAlt} />
          <p className="muted small">
            {tf.moveManual} <code className="setup-key">{setupKeyOf(panel.totpUri)}</code>
          </p>
          <label className="fld">
            <span className="lbl">{tf.moveStep2}</span>
            <input
              className="inp code-input"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              aria-label={tf.codeLabel}
              autoFocus
            />
          </label>
          <p className="muted small">{tf.moveKeep}</p>
          <div className="actions">
            <button className="btn" type="submit" disabled={busy}>
              {busy ? tf.working : tf.moveConfirm}
            </button>
            <button className="btn2" type="button" onClick={() => open({ name: 'closed' })} disabled={busy}>
              {tf.cancel}
            </button>
          </div>
        </form>
      )}

      {panel.name === 'move-done' && (
        <div className="panel">
          <p className="alert alert-ok" role="status">
            {tf.moveDone}
          </p>
          <h3>{tf.codesTitle}</h3>
          <p className="muted small">{tf.codesNote}</p>
          <BackupCodes codes={panel.codes} />
          <div className="actions">
            <button className="btn" type="button" onClick={() => open({ name: 'closed' })}>
              {tf.codesDone}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function DevicesCard({ devices, signedOut, onChanged }: { devices: AdminDevice[]; signedOut: () => void; onChanged: () => void }) {
  const d = a.devices;
  const [busyId, setBusyId] = useState<number | 'all' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const others = devices.filter((x) => !x.current);

  async function signOutOne(id: number) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    const r = await signOutDevice(id);
    setBusyId(null);
    const err = problem(r, signedOut);
    if (err) return setError(err);
    setNotice(d.signedOutOne);
    onChanged();
  }

  async function signOutAll() {
    setBusyId('all');
    setError(null);
    setNotice(null);
    const r = await signOutOtherDevices();
    setBusyId(null);
    const err = problem(r, signedOut);
    if (err) return setError(err);
    if (r.kind === 'ok') setNotice(d.signedOutMany(r.data.signedOut));
    onChanged();
  }

  return (
    <section className="card admin-section" aria-labelledby="acct-devices">
      <h2 id="acct-devices">{d.title}</h2>
      <ul className="device-list">
        {devices.map((device) => (
          <li key={device.id}>
            <div>
              <div className="device-title">{device.device}</div>
              <div className="muted small">
                {device.ipAddress ?? d.unknownIp} · {device.current ? d.thisDevice : d.lastActive(formatDateTime(device.lastActiveAt))}
              </div>
              {!device.current && <div className="muted small">{d.signedIn(formatDateTime(device.signedInAt))}</div>}
            </div>
            {device.current ? (
              <span className="tag">{d.thisDevice}</span>
            ) : (
              <button type="button" className="btn2 btn-sm" disabled={busyId !== null} onClick={() => void signOutOne(device.id)}>
                {d.signOut}
              </button>
            )}
          </li>
        ))}
      </ul>
      {others.length === 0 && <p className="muted small">{d.none}</p>}
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="alert alert-ok" role="status">
          {notice}
        </p>
      )}
      {others.length > 0 && (
        <div className="actions">
          <button type="button" className="btn2" disabled={busyId !== null} onClick={() => void signOutAll()}>
            {d.signOutOthers}
          </button>
        </div>
      )}
      <p className="muted small">{d.note}</p>
    </section>
  );
}
