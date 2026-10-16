'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { webSignInLinkSchema } from '@outletbooking/shared';
import { requestSignInLink } from '@/lib/billing-api';
import { clock } from '@/lib/billing-format';
import { apiLive, links } from '@/lib/config';
import { s } from '@/strings/en';

const t = s.billing;
const c = t.signIn;
const COOLDOWN = 60;

/** I13 · Website sign-in by a one-time email link, and the "check your email" state with a resend timer. */
export function BillingSignIn() {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function send(ev?: FormEvent) {
    ev?.preventDefault();
    const parsed = webSignInLinkSchema.safeParse({ email });
    if (!parsed.success) return setError(c.invalid);
    setBusy(true);
    setError(null);
    const r = await requestSignInLink(parsed.data.email);
    setBusy(false);
    if (r === 'sent') {
      setSentTo(parsed.data.email);
      setWait(COOLDOWN);
    } else {
      setError(r === 'invalid' ? c.invalid : r === 'rate_limited' ? c.tooMany : c.error);
    }
  }

  if (!apiLive) {
    return (
      <div className="card billing-card">
        <p>{t.notAvailable}</p>
        <a className="btn" href={links.whatsapp()} target="_blank" rel="noopener noreferrer">
          {t.whatsapp}
        </a>
      </div>
    );
  }

  if (sentTo) {
    return (
      <div className="card billing-card" role="status">
        <h1>{c.sentTitle}</h1>
        <p>{c.sentText(sentTo)}</p>
        <p className="muted small">{c.sentNote}</p>
        <div>
          <button type="button" className="btn2" disabled={wait > 0 || busy} onClick={() => void send()}>
            {wait > 0 ? c.againIn(clock(wait)) : c.again}
          </button>
        </div>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    // method="post": a submit before JS loads must never put the email in the URL.
    <form method="post" className="card billing-card" onSubmit={send} noValidate>
      <h1>{c.title}</h1>
      <p className="muted">{c.intro}</p>
      <label className="fld">
        <span className="lbl">{c.email}</span>
        <input
          className="inp"
          type="email"
          name="email"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
      </label>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn" disabled={busy}>
        {busy ? c.sending : c.submit}
      </button>
      <p className="muted small">{c.fromApp}</p>
    </form>
  );
}
