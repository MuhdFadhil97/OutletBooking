/**
 * Outgoing email. Callers only see `Mailer`.
 *  - `resend`: Resend HTTP API (https://resend.com) — staging / production.
 *  - `console`: prints the message (with the reset link) to the API log — local development only.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export type MailTransport = 'console' | 'resend';

export interface MailerConfig {
  NODE_ENV: string;
  MAIL_TRANSPORT: MailTransport;
  /** "OutletBooking <no-reply@your-verified-domain>" — the domain must be verified in Resend. */
  MAIL_FROM?: string;
  RESEND_API_KEY?: string;
}

const RESEND_URL = 'https://api.resend.com/emails';

export function createMailer(config: MailerConfig, fetchFn: typeof fetch = fetch): Mailer {
  switch (config.MAIL_TRANSPORT) {
    case 'console':
      if (config.NODE_ENV === 'production') {
        throw new Error('MAIL_TRANSPORT=console prints reset links to the log — use MAIL_TRANSPORT=resend in production');
      }
      return {
        async send({ to, subject, text }) {
          if (config.NODE_ENV === 'test') return;
          console.log(`\n[mail] To: ${to}\n[mail] Subject: ${subject}\n${text}\n`);
        },
      };
    case 'resend': {
      const { RESEND_API_KEY: apiKey, MAIL_FROM: from } = config;
      if (!apiKey || !from) throw new Error('MAIL_TRANSPORT=resend needs RESEND_API_KEY and MAIL_FROM');
      return {
        async send({ to, subject, text }) {
          const res = await fetchFn(RESEND_URL, {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({ from, to: [to], subject, text }),
          });
          if (!res.ok) {
            // Never log the key or the message body (it holds the reset link).
            throw new Error(`Resend rejected the email (${res.status}): ${(await res.text()).slice(0, 300)}`);
          }
        },
      };
    }
  }
}
