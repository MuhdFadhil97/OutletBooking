import { LEGAL_COMPANY } from '@outletbooking/shared';

/**
 * The one template for every transactional email (M1–M7, docs/wireframes/Email-*.dc.html):
 * logo bar, heading, paragraphs, one green button, small notes, "copy this link", grey footer.
 * Inline styles and tables only, so Gmail / Outlook / phone mail apps show it the same.
 * Every email also gets a plain-text version.
 */

/** A paragraph: plain strings, or `{ bold }` for the business name and similar. */
export type EmailText = string | { bold: string };
export type EmailParagraph = EmailText | EmailText[];

export interface EmailContent {
  subject: string;
  /** Shown next to the subject in the inbox. */
  preview: string;
  heading: string;
  paragraphs: EmailParagraph[];
  button: { label: string; url: string };
  /** Small grey lines under the button ("This link expires in 24 hours."). */
  notes: string[];
  /** Why they got it ("You got this email because…"). */
  footer: string;
  /** Website base URL, for the privacy notice link. */
  websiteUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const C = {
  primary: '#0F7B55',
  bg: '#F6F7F5',
  card: '#FFFFFF',
  border: '#E1E6E2',
  text: '#16211C',
  muted: '#56625B',
};
const FONT = "Manrope, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const parts = (p: EmailParagraph): EmailText[] => (Array.isArray(p) ? p : [p]);
const partHtml = (t: EmailText) => (typeof t === 'string' ? escapeHtml(t) : `<b>${escapeHtml(t.bold)}</b>`);
const partText = (t: EmailText) => (typeof t === 'string' ? t : t.bold);

export function renderEmail(e: EmailContent): RenderedEmail {
  const privacyUrl = new URL('/privacy', e.websiteUrl).toString();
  const url = escapeHtml(e.button.url);
  const p = (inner: string, style = '') =>
    `<tr><td style="padding:0 0 16px 0;font-size:15px;line-height:1.6;color:${C.text};${style}">${inner}</td></tr>`;
  const small = (inner: string) => p(inner, `font-size:13px;color:${C.muted};`);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(e.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(e.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};font-family:${FONT};">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.card};border:1px solid ${C.border};border-radius:14px;">
<tr><td style="padding:20px 28px;border-bottom:1px solid ${C.border};font-size:18px;font-weight:800;color:${C.primary};">OutletBooking</td></tr>
<tr><td style="padding:28px 28px 12px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:0 0 16px 0;font-size:24px;font-weight:800;line-height:1.3;color:${C.text};">${escapeHtml(e.heading)}</td></tr>
${e.paragraphs.map((para) => p(parts(para).map(partHtml).join(''))).join('\n')}
<tr><td style="padding:0 0 16px 0;"><a href="${url}" style="display:inline-block;padding:14px 22px;border-radius:12px;background:${C.primary};color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;">${escapeHtml(e.button.label)}</a></td></tr>
${e.notes.map((n) => small(escapeHtml(n))).join('\n')}
${small(`Button not working? Copy this link into your browser:<br><a href="${url}" style="color:${C.primary};word-break:break-all;">${url}</a>`)}
</table>
</td></tr>
<tr><td style="padding:18px 28px;background:${C.bg};border-radius:0 0 14px 14px;font-size:12px;line-height:1.6;color:${C.muted};">${escapeHtml(e.footer)}<br>${escapeHtml(LEGAL_COMPANY)} · <a href="${escapeHtml(privacyUrl)}" style="color:${C.primary};">Privacy notice</a></td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    e.heading,
    '',
    ...e.paragraphs.flatMap((para) => [parts(para).map(partText).join(''), '']),
    `${e.button.label}: ${e.button.url}`,
    '',
    ...e.notes,
    '',
    '—',
    e.footer,
    `${LEGAL_COMPANY} · Privacy notice: ${privacyUrl}`,
  ].join('\n');

  return { subject: e.subject, html, text };
}
