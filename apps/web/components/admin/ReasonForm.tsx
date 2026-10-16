'use client';

import { useState, type FormEvent } from 'react';
import { adminReason } from '@outletbooking/shared';
import { s } from '@/strings/en';

const d = s.admin.business;

/**
 * Every admin change needs a reason (3–500 characters), saved in the audit log.
 * `onSubmit` returns an error to show, or null when it worked (the form then clears).
 */
export function ReasonForm({
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
