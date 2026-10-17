/**
 * Outgoing email. Callers only see `Mailer`.
 *  - `resend`: Resend HTTP API (https://resend.com) — staging / production.
 *  - `console`: prints the message (with the reset link) to the API log — local development only.
 */
import type { EmailTemplate } from '@outletbooking/shared';

/** Which email this is, so delivery problems (bounces, spam reports) can be traced to a business (I27). */
export interface MailMeta {
  template: EmailTemplate;
  businessId?: number | null;
  userId?: number | null;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** The same message from the shared template (services/email-template.ts). */
  html?: string;
  /** Files sent with the email (the plan receipt PDF). */
  attachments?: { filename: string; content: Buffer }[];
  /** Optional: tracked in `email_events` when the mailer is wrapped by `trackMail`. Never sent to the provider. */
  meta?: MailMeta;
}

/** What a send returns: the provider's id for the message, when it gives one (Resend does). */
export interface MailReceipt {
  providerId?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<MailReceipt | void>;
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
        async send({ to, subject, text, attachments }) {
          if (config.NODE_ENV === 'test') return;
          const files = attachments?.map((a) => `[mail] Attachment: ${a.filename} (${a.content.length} bytes)\n`).join('') ?? '';
          console.log(`\n[mail] To: ${to}\n[mail] Subject: ${subject}\n${files}${text}\n`);
        },
      };
    case 'resend': {
      const { RESEND_API_KEY: apiKey, MAIL_FROM: from } = config;
      if (!apiKey || !from) throw new Error('MAIL_TRANSPORT=resend needs RESEND_API_KEY and MAIL_FROM');
      return {
        async send({ to, subject, text, html, attachments }) {
          const res = await fetchFn(RESEND_URL, {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              from,
              to: [to],
              subject,
              text,
              ...(html ? { html } : {}),
              ...(attachments?.length
                ? { attachments: attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })) }
                : {}),
            }),
          });
          if (!res.ok) {
            // Never log the key or the message body (it holds the reset link).
            throw new Error(`Resend rejected the email (${res.status}): ${(await res.text()).slice(0, 300)}`);
          }
          // Resend answers { id } — the webhook (I27) names the message by it.
          const sent = (await res.json().catch(() => null)) as { id?: unknown } | null;
          return typeof sent?.id === 'string' ? { providerId: sent.id } : {};
        },
      };
    }
  }
}
