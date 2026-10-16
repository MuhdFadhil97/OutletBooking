'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ADMIN_LOCK_MINUTES, ADMIN_MAX_SIGN_IN_FAILURES } from '@outletbooking/shared';
import {
  getAdminMe,
  setupKeyOf,
  signInWithPassword,
  signOut,
  startTwoFactorSetup,
  verifyCode,
  type CodeResult,
} from '@/lib/admin-auth';
import { s } from '@/strings/en';
import { BackupCodes } from './BackupCodes';
import { SetupQr } from './SetupQr';

type Step =
  | { name: 'password' }
  | { name: 'code'; mode: 'totp' | 'backup' }
  | { name: 'setup'; totpUri: string; backupCodes: string[] };

const t = s.admin;

/** I5 sign in → I6 two-step code (or, the first time, set up two-step) → /admin. */
export function AdminSignIn() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: 'password' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept in memory only, for the first-time setup call (Better Auth asks for the password again).
  const password = useRef('');
  // Sent here by the 8-hour idle sign-out (/admin/login?expired=1).
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(new URLSearchParams(window.location.search).get('expired') === '1');
  }, []);

  function fail(message: string) {
    setError(message);
    setBusy(false);
  }

  /** After a full session exists: only real admins continue to /admin. */
  async function finish() {
    const me = await getAdminMe();
    if (me.kind === 'ok') {
      password.current = '';
      router.replace('/admin');
      return;
    }
    if (me.kind === 'setup_required') {
      const setup = await startTwoFactorSetup(password.current);
      if (setup.kind === 'ok') {
        setStep({ name: 'setup', totpUri: setup.totpUri, backupCodes: setup.backupCodes });
        setError(null);
        setBusy(false);
        return;
      }
      return fail(t.signIn.error);
    }
    if (me.kind === 'not_admin') {
      await signOut();
      return fail(t.signIn.notAdmin);
    }
    fail(t.signIn.error);
  }

  async function onPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const email = String(data.get('email') ?? '').trim();
    const pw = String(data.get('password') ?? '');
    if (!email || !pw) return fail(t.signIn.required);
    setBusy(true);
    setError(null);
    password.current = pw;
    const result = await signInWithPassword(email, pw);
    if (result.kind === 'two_factor') {
      setStep({ name: 'code', mode: 'totp' });
      setBusy(false);
    } else if (result.kind === 'signed_in') {
      await finish();
    } else if (result.kind === 'wrong') {
      fail(t.signIn.wrong);
    } else if (result.kind === 'locked') {
      fail(result.message);
    } else {
      fail(t.signIn.error);
    }
  }

  function codeError(result: CodeResult, backup: boolean) {
    if (result.kind === 'wrong') return fail(backup ? t.code.wrongBackup : t.code.wrong);
    if (result.kind === 'locked') return fail(t.code.locked(ADMIN_LOCK_MINUTES));
    if (result.kind === 'expired') {
      setStep({ name: 'password' });
      return fail(t.code.expired);
    }
    fail(t.signIn.error);
  }

  async function onCode(e: FormEvent<HTMLFormElement>, mode: 'totp' | 'backup') {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '').trim();
    if (!code) return;
    setBusy(true);
    setError(null);
    const result = await verifyCode(code, mode);
    if (result.kind === 'ok') await finish();
    else codeError(result, mode === 'backup');
  }

  async function onSetup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    if (data.get('saved') !== 'on') return fail(t.setup.savedFirst);
    const code = String(data.get('code') ?? '').trim();
    if (!code) return;
    setBusy(true);
    setError(null);
    const result = await verifyCode(code, 'totp');
    if (result.kind === 'ok') await finish();
    else codeError(result, false);
  }

  const alert = error ? (
    <p className="alert alert-error" role="alert">
      {error}
    </p>
  ) : null;

  if (step.name === 'setup') {
    return (
      <form method="post" className="card admin-card admin-card-wide" onSubmit={onSetup} noValidate>
        <h1>{t.setup.title}</h1>
        <p className="muted">{t.setup.intro}</p>
        <ol className="admin-steps">
          <li>
            <p>{t.setup.step1}</p>
            <SetupQr uri={step.totpUri} alt={t.setup.qrAlt} />
            <p className="muted small">
              {t.setup.manual} <code className="setup-key">{setupKeyOf(step.totpUri)}</code>
            </p>
          </li>
          <li>
            <p>{t.setup.step2}</p>
            <BackupCodes codes={step.backupCodes} />
            <label className="check">
              <input type="checkbox" name="saved" />
              <span>{t.setup.saved}</span>
            </label>
          </li>
          <li>
            <label className="fld">
              <span>{t.setup.step3}</span>
              <CodeInput />
            </label>
          </li>
        </ol>
        {alert}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? t.code.submitting : t.setup.submit}
        </button>
      </form>
    );
  }

  if (step.name === 'code') {
    const backup = step.mode === 'backup';
    return (
      <form key={step.mode} method="post" className="card admin-card" onSubmit={(e) => onCode(e, step.mode)} noValidate>
        <h1>{backup ? t.code.backupTitle : t.code.title}</h1>
        <p className="muted">{backup ? t.code.backupIntro : t.code.intro}</p>
        <label className="fld">
          <span className="lbl">{backup ? t.code.backupLabel : t.code.label}</span>
          {backup ? <input className="inp" name="code" autoComplete="off" autoFocus spellCheck={false} /> : <CodeInput />}
        </label>
        {alert}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? t.code.submitting : t.code.submit}
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setError(null);
            setStep({ name: 'code', mode: backup ? 'totp' : 'backup' });
          }}
        >
          {backup ? t.code.useApp : t.code.useBackup}
        </button>
        <p className="muted small">{t.code.note}</p>
      </form>
    );
  }

  // method="post": if JS has not loaded yet, a submit must never put the password in the URL.
  return (
    <form method="post" className="card admin-card" onSubmit={onPassword} noValidate>
      <h1>{t.signIn.title}</h1>
      {expired && (
        <p className="alert alert-warn" role="status">
          {t.idleExpired}
        </p>
      )}
      <label className="fld">
        <span className="lbl">{t.signIn.email}</span>
        <input className="inp" name="email" type="email" autoComplete="username" autoFocus required />
      </label>
      <label className="fld">
        <span className="lbl">{t.signIn.password}</span>
        <input className="inp" name="password" type="password" autoComplete="current-password" required />
      </label>
      {alert}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? t.signIn.submitting : t.signIn.submit}
      </button>
      <p className="muted small">{t.signIn.forgot}</p>
      <p className="muted small">{t.signIn.logged(ADMIN_MAX_SIGN_IN_FAILURES, ADMIN_LOCK_MINUTES)}</p>
    </form>
  );
}

function CodeInput() {
  return (
    <input
      className="inp code-input"
      name="code"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{6}"
      maxLength={6}
      autoFocus
      required
    />
  );
}
