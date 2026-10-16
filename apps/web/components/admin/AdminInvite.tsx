'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { acceptAdminInviteSchema, type AdminInviteInfo } from '@outletbooking/shared';
import { acceptAdminInvite, getAdminInvite } from '@/lib/admin-api';
import { s } from '@/strings/en';

const t = s.admin;
const v = t.invite;

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; invite: AdminInviteInfo }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'error' }
  | { kind: 'done' };

/** I10 invite link: set a name and password, then sign in at /admin/login and set up two-step (I6). */
export function AdminInvite({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [errors, setErrors] = useState<Partial<Record<'name' | 'password' | 'confirm' | 'form', string>>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void getAdminInvite(token).then((r) => {
      if (!live) return;
      setState(r.kind === 'ok' ? { kind: 'ok', invite: r.data } : r);
    });
    return () => {
      live = false;
    };
  }, [token, attempt]);

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = new FormData(ev.currentTarget);
    const password = String(form.get('password') ?? '');
    const parsed = acceptAdminInviteSchema.safeParse({ name: form.get('name'), password });
    const next: typeof errors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === 'name' || key === 'password') && !next[key]) next[key] = issue.message;
      }
    }
    if (password !== String(form.get('confirm') ?? '')) next.confirm = v.mismatch;
    setErrors(next);
    if (!parsed.success || next.confirm) return;

    setBusy(true);
    const r = await acceptAdminInvite(token, parsed.data);
    setBusy(false);
    if (r.kind === 'ok') setState({ kind: 'done' });
    else if (r.kind === 'error') setErrors({ form: t.business.saveError });
    else setState(r);
  }

  if (state.kind === 'loading') return <p className="muted">{t.loading}</p>;
  if (state.kind === 'error') {
    return (
      <div className="card admin-card">
        <p className="alert alert-error" role="alert">
          {t.loadError}
        </p>
        <button type="button" className="btn2" onClick={() => setAttempt((n) => n + 1)}>
          {t.retry}
        </button>
      </div>
    );
  }
  if (state.kind === 'invalid' || state.kind === 'expired') {
    return (
      <div className="card admin-card">
        <h1>{v.title}</h1>
        <p className="alert alert-error" role="alert">
          {state.kind === 'expired' ? v.expired : v.invalid}
        </p>
      </div>
    );
  }
  if (state.kind === 'done') {
    return (
      <div className="card admin-card">
        <h1>{v.done}</h1>
        <p className="muted">{v.next}</p>
        <Link className="btn" href="/admin/login">
          {v.signIn}
        </Link>
      </div>
    );
  }

  const { invite } = state;
  // method="post": if JS has not loaded yet, a submit must never put the password in the URL.
  return (
    <form method="post" className="card admin-card" onSubmit={submit} noValidate>
      <h1>{v.title}</h1>
      <p>{v.intro(invite.email, t.roles[invite.role])}</p>
      {invite.invitedBy && <p className="muted small">{v.invitedBy(invite.invitedBy)}</p>}
      <input type="email" name="username" autoComplete="username" value={invite.email} readOnly hidden />
      <label className="fld">
        <span className="lbl">{v.name}</span>
        <input className="inp" name="name" autoComplete="name" autoFocus aria-invalid={errors.name ? true : undefined} />
        {errors.name && <span className="field-error">{errors.name}</span>}
      </label>
      <label className="fld">
        <span className="lbl">{v.password}</span>
        <input
          className="inp"
          name="password"
          type="password"
          autoComplete="new-password"
          aria-describedby="invite-password-hint"
          aria-invalid={errors.password ? true : undefined}
        />
        <span id="invite-password-hint" className="muted small">
          {v.passwordHint}
        </span>
        {errors.password && <span className="field-error">{errors.password}</span>}
      </label>
      <label className="fld">
        <span className="lbl">{v.confirm}</span>
        <input className="inp" name="confirm" type="password" autoComplete="new-password" aria-invalid={errors.confirm ? true : undefined} />
        {errors.confirm && <span className="field-error">{errors.confirm}</span>}
      </label>
      {errors.form && (
        <p className="alert alert-error" role="alert">
          {errors.form}
        </p>
      )}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? v.saving : v.submit}
      </button>
      <p className="muted small">{v.next}</p>
    </form>
  );
}
