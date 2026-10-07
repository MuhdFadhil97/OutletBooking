/**
 * Outgoing email. No provider is chosen yet, so the only transport is `console`:
 * it prints the message (with the reset link) to the API log in development.
 * Add an SMTP / Resend / SES transport here when one is picked — callers only see `Mailer`.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export type MailTransport = 'console';

export function createMailer(transport: MailTransport, nodeEnv: string): Mailer {
  switch (transport) {
    case 'console':
      if (nodeEnv === 'production') {
        throw new Error('MAIL_TRANSPORT=console prints reset links to the log — configure a real email provider for production');
      }
      return {
        async send({ to, subject, text }) {
          if (nodeEnv === 'test') return;
          console.log(`\n[mail] To: ${to}\n[mail] Subject: ${subject}\n${text}\n`);
        },
      };
  }
}
