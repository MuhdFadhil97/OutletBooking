'use client';

import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { ADMIN_ROLES, inviteAdminSchema, type AdminRole, type AdminUserRow } from '@outletbooking/shared';
import { adminUserAction, changeAdminRole, inviteAdmin, listAdminUsers, type AdminUserAction, type Result } from '@/lib/admin-api';
import { formatDate, formatDateTime } from '@/lib/admin-format';
import { s } from '@/strings/en';
import { useAdmin } from './AdminShell';
import { ReasonForm } from './ReasonForm';

const t = s.admin;
const u = t.users;

type State = { kind: 'loading' } | { kind: 'ok'; rows: AdminUserRow[] } | { kind: 'refused'; message: string } | { kind: 'error' };
type ActionKind = 'role' | 'resetTwoFactor' | 'remove' | 'resend' | 'cancel';
const API_ACTION: Record<Exclude<ActionKind, 'role'>, AdminUserAction> = {
  resetTwoFactor: 'reset-two-factor',
  remove: 'remove',
  resend: 'resend-invite',
  cancel: 'remove',
};

/** I10 · Admin users: list, invite, change role, reset two-step, remove; resend / cancel invites. Super admins only. */
export function AdminUsers() {
  const { admin, signedOut } = useAdmin();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<{ userId: number; kind: ActionKind } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (admin.role !== 'super_admin') return;
    let live = true;
    void listAdminUsers().then((r) => {
      if (!live) return;
      if (r.kind === 'ok') setState({ kind: 'ok', rows: r.data });
      else if (r.kind === 'signed_out') signedOut();
      else if (r.kind === 'refused') setState({ kind: 'refused', message: r.message });
      else setState({ kind: 'error' });
    });
    return () => {
      live = false;
    };
  }, [admin.role, attempt, signedOut]);

  /** Applies a change's result; returns an error to show, or null when it worked. */
  function apply(r: Result<AdminUserRow[]>, done: string): string | null {
    if (r.kind === 'ok') {
      setState({ kind: 'ok', rows: r.data });
      setOpen(null);
      setNotice(done);
      return null;
    }
    if (r.kind === 'signed_out') {
      signedOut();
      return null;
    }
    if (r.kind === 'refused') return r.message;
    return t.business.saveError;
  }

  if (admin.role !== 'super_admin') {
    return (
      <div className="admin-page">
        <h1>{u.title}</h1>
        <p className="card admin-empty muted">{u.superOnly}</p>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>{u.title}</h1>
          <p className="muted">{u.subtitle}</p>
        </div>
      </div>
      {notice && (
        <p className="alert alert-ok" role="status">
          {notice}
        </p>
      )}

      {state.kind === 'loading' && <p className="muted">{t.loading}</p>}
      {state.kind === 'refused' && <p className="card admin-empty muted">{state.message || u.superOnly}</p>}
      {state.kind === 'error' && (
        <div className="card admin-card">
          <p className="alert alert-error" role="alert">
            {t.loadError}
          </p>
          <button type="button" className="btn2" onClick={() => setAttempt((n) => n + 1)}>
            {t.retry}
          </button>
        </div>
      )}
      {state.kind === 'ok' && (
        <div className="card table-card">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{u.cols.admin}</th>
                <th>{u.cols.role}</th>
                <th>{u.cols.twoFactor}</th>
                <th>{u.cols.lastSignIn}</th>
                <th>{u.cols.status}</th>
                <th>
                  <span className="sr-only">{u.actions.role}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row) => {
                const me = row.userId === admin.userId;
                const kind = open?.userId === row.userId ? open.kind : null;
                const toggle = (k: ActionKind) => {
                  setNotice(null);
                  setOpen(kind === k ? null : { userId: row.userId, kind: k });
                };
                return (
                  <Fragment key={row.userId}>
                    <tr>
                      <td>
                        <div className="row-title">{row.name}</div>
                        <div className="muted small">{row.email}</div>
                      </td>
                      <td>{t.roles[row.role]}</td>
                      <td>
                        <span className={row.twoFactorEnabled ? 'tag' : 'tag tag-gray'}>
                          {row.twoFactorEnabled ? u.twoFactorOn : u.twoFactorOff}
                        </span>
                      </td>
                      <td>{row.lastSignInAt ? formatDateTime(row.lastSignInAt) : u.never}</td>
                      <td>
                        <span className={row.status === 'active' ? 'tag' : 'tag tag-pend'}>{u.status[row.status]}</span>
                        {row.status === 'invited' && (
                          <div className="muted small">
                            {row.inviteExpiresAt ? u.inviteExpires(formatDate(row.inviteExpiresAt)) : u.inviteExpired}
                          </div>
                        )}
                      </td>
                      <td className="actions-cell">
                        {me ? (
                          <span className="tag tag-blue">{u.you}</span>
                        ) : (
                          <div className="row-actions">
                            {row.status === 'invited' ? (
                              <>
                                <ActionButton label={u.actions.resend} on={kind === 'resend'} onClick={() => toggle('resend')} />
                                <ActionButton label={u.actions.cancel} on={kind === 'cancel'} onClick={() => toggle('cancel')} />
                              </>
                            ) : (
                              <>
                                <ActionButton label={u.actions.role} on={kind === 'role'} onClick={() => toggle('role')} />
                                {row.twoFactorEnabled && (
                                  <ActionButton
                                    label={u.actions.resetTwoFactor}
                                    on={kind === 'resetTwoFactor'}
                                    onClick={() => toggle('resetTwoFactor')}
                                  />
                                )}
                                <ActionButton label={u.actions.remove} on={kind === 'remove'} onClick={() => toggle('remove')} />
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                    {kind && (
                      <tr className="action-row">
                        <td colSpan={6}>
                          <RowAction row={row} kind={kind} onCancel={() => setOpen(null)} apply={apply} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="users-bottom">
        <InviteForm
          onInvite={async (input) => {
            const r = await inviteAdmin(input);
            return apply(r, u.done.invite(input.email));
          }}
        />
        <section className="card admin-section">
          <dl className="role-list">
            {ADMIN_ROLES.map((role) => (
              <div key={role}>
                <dt>{t.roles[role]}</dt>
                <dd className="muted">{u.roles[role]}</dd>
              </div>
            ))}
            <div>
              <dt>{u.roles.nobodyLabel}</dt>
              <dd className="muted">{u.roles.nobody}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}

function ActionButton({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={on ? 'btn btn-sm' : 'btn2 btn-sm'} aria-expanded={on} onClick={onClick}>
      {label}
    </button>
  );
}

function RowAction({
  row,
  kind,
  onCancel,
  apply,
}: {
  row: AdminUserRow;
  kind: ActionKind;
  onCancel: () => void;
  apply: (r: Result<AdminUserRow[]>, done: string) => string | null;
}) {
  const otherRole: AdminRole = row.role === 'super_admin' ? 'support' : 'super_admin';
  const text =
    kind === 'role'
      ? u.confirm.role(row.name, t.roles[otherRole])
      : kind === 'resetTwoFactor'
        ? u.confirm.resetTwoFactor(row.name)
        : kind === 'remove'
          ? u.confirm.remove(row.name)
          : kind === 'resend'
            ? u.confirm.resend(row.email)
            : u.confirm.cancel(row.email);
  return (
    <div className="row-action">
      <p>{text}</p>
      <ReasonForm
        label={t.business.reason}
        submit={kind === 'role' ? u.actions.role : u.actions[kind]}
        danger={kind === 'remove' || kind === 'cancel'}
        onCancel={onCancel}
        onSubmit={async (reason) =>
          kind === 'role'
            ? apply(await changeAdminRole(row.userId, otherRole, reason), u.done.role)
            : apply(await adminUserAction(row.userId, API_ACTION[kind], reason), u.done[kind])
        }
      />
    </div>
  );
}

function InviteForm({ onInvite }: { onInvite: (input: { email: string; role: AdminRole; reason: string }) => Promise<string | null> }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminRole>('support');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'email' | 'reason' | 'form', string>>>({});
  const [busy, setBusy] = useState(false);

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const parsed = inviteAdminSchema.safeParse({ email, role, reason });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === 'email' || key === 'reason') && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setBusy(true);
    setErrors({});
    const err = await onInvite(parsed.data);
    setBusy(false);
    if (err) setErrors({ form: err });
    else {
      setEmail('');
      setReason('');
      setRole('support');
    }
  }

  return (
    <form method="post" className="card admin-section invite-form" onSubmit={submit} noValidate>
      <h2>{u.invite.title}</h2>
      <label className="fld">
        <span className="lbl">{u.invite.email}</span>
        <input
          className="inp"
          type="email"
          autoComplete="off"
          value={email}
          placeholder={u.invite.emailPlaceholder}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={errors.email ? true : undefined}
        />
        {errors.email && <span className="field-error">{errors.email}</span>}
      </label>
      <fieldset className="fld">
        <legend className="lbl">{u.invite.role}</legend>
        <div className="chips">
          {ADMIN_ROLES.map((r) => (
            <label key={r} className="chip">
              <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} />
              {t.roles[r]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="fld">
        <span className="lbl">{t.business.reason}</span>
        <textarea
          className="inp"
          rows={2}
          maxLength={500}
          value={reason}
          placeholder={t.business.reasonPlaceholder}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={errors.reason ? true : undefined}
        />
        {errors.reason && <span className="field-error">{errors.reason}</span>}
      </label>
      {errors.form && (
        <p className="alert alert-error" role="alert">
          {errors.form}
        </p>
      )}
      <div>
        <button type="submit" className="btn" disabled={busy}>
          {busy ? u.invite.sending : u.invite.submit}
        </button>
      </div>
    </form>
  );
}
