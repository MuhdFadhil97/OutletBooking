'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  BUSINESS_TEMPLATES,
  LEAD_REASONS,
  leadCreateSchema,
  normalizeMyPhone,
  type LeadCreateInput,
  type LeadReason,
} from '@outletbooking/shared';
import { submitLead } from '@/lib/api';
import { s } from '@/strings/en';

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string };
type FieldErrors = Partial<Record<keyof LeadCreateInput, string>>;

const isReason = (v: string | undefined): v is LeadReason => LEAD_REASONS.some((r) => r === v);

/** I19 contact form → POST /public/leads. Validated with the same zod schema as the API. */
export function ContactForm({ initialReason }: { initialReason?: string }) {
  const c = s.contact;
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [errors, setErrors] = useState<FieldErrors>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const text = (k: string) => String(data.get(k) ?? '');
    const phone = text('phone').trim();
    const input = {
      reason: text('reason'),
      name: text('name'),
      businessName: text('businessName'),
      phone: phone ? normalizeMyPhone(phone) : '',
      email: text('email').trim(),
      businessType: text('businessType'),
      resourceCount: text('resourceCount'),
      message: text('message'),
      consent: data.get('consent') === 'on',
    };

    const parsed = leadCreateSchema.safeParse(input);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof LeadCreateInput | undefined;
        if (key && !next[key]) next[key] = key === 'phone' && issue.code === 'custom' ? c.phoneOrEmail : issue.message;
      }
      setErrors(next);
      const first = Object.keys(next)[0];
      if (first) form.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }

    setErrors({});
    setStatus({ kind: 'sending' });
    const result = await submitLead(parsed.data);
    if (result === 'ok') {
      form.reset();
      setStatus({ kind: 'sent' });
    } else {
      setStatus({ kind: 'error', message: result === 'rate_limited' ? c.tooMany : c.error });
    }
  }

  if (status.kind === 'sent') {
    return (
      <div className="card contact-form" role="status">
        <p className="alert alert-ok">{c.sent}</p>
        <button type="button" className="btn2" onClick={() => setStatus({ kind: 'idle' })}>
          {c.sendAnother}
        </button>
      </div>
    );
  }

  const err = (k: keyof LeadCreateInput) =>
    errors[k] ? (
      <span id={`${k}-error`} className="field-error">
        {errors[k]}
      </span>
    ) : null;
  const aria = (k: keyof LeadCreateInput) =>
    errors[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${k}-error` } : {};

  return (
    <form className="card contact-form" onSubmit={onSubmit} noValidate>
      <fieldset className="fld" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="lbl" style={{ marginBottom: 8 }}>
          {c.need}
        </legend>
        <div className="chips">
          {LEAD_REASONS.map((r) => (
            <label key={r} className="chip">
              <input type="radio" name="reason" value={r} defaultChecked={r === (isReason(initialReason) ? initialReason : 'demo')} />
              {c.reasons[r]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-2">
        <label className="fld">
          <span className="lbl">{c.name}</span>
          <input className="inp" name="name" autoComplete="name" required {...aria('name')} />
          {err('name')}
        </label>
        <label className="fld">
          <span className="lbl">{c.businessName}</span>
          <input className="inp" name="businessName" autoComplete="organization" {...aria('businessName')} />
          {err('businessName')}
        </label>
        <label className="fld">
          <span className="lbl">{c.phone}</span>
          <input
            className="inp"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={c.phonePlaceholder}
            {...aria('phone')}
          />
          {err('phone')}
        </label>
        <label className="fld">
          <span className="lbl">{c.email}</span>
          <input className="inp" name="email" type="email" autoComplete="email" {...aria('email')} />
          {err('email')}
        </label>
        <label className="fld">
          <span className="lbl">{c.businessType}</span>
          <select className="inp" name="businessType" defaultValue="">
            <option value="">{c.businessTypeChoose}</option>
            {BUSINESS_TEMPLATES.map((t) => (
              <option key={t} value={t}>
                {c.businessTypes[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span className="lbl">{c.resourceCount}</span>
          <input className="inp" name="resourceCount" {...aria('resourceCount')} />
          {err('resourceCount')}
        </label>
      </div>

      <label className="fld">
        <span className="lbl">{c.message}</span>
        <textarea className="inp" name="message" rows={4} {...aria('message')} />
        {err('message')}
      </label>

      <div className="fld">
        <label className="check">
          <input type="checkbox" name="consent" {...aria('consent')} />
          <span>
            {c.consent} <Link href="/privacy">{c.consentLink}</Link>.
          </span>
        </label>
        {err('consent')}
      </div>

      {status.kind === 'error' && (
        <p className="alert alert-error" role="alert">
          {status.message}
        </p>
      )}

      <div>
        <button className="btn" type="submit" disabled={status.kind === 'sending'}>
          {status.kind === 'sending' ? c.sending : c.send}
        </button>
      </div>
    </form>
  );
}
