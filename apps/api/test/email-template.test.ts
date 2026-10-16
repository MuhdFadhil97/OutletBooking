import { describe, expect, it } from 'vitest';
import { renderEmail } from '../src/services/email-template';

const email = renderEmail({
  subject: 'You’re invited',
  preview: 'Preview',
  heading: 'Join <the> panel',
  paragraphs: [[{ bold: 'Fadhil' }, ' added you.']],
  button: { label: 'Set my password', url: 'https://outletbooking.my/admin/invite/abc?x=1&y=2' },
  notes: ['This link works once.'],
  footer: 'Sent because…',
  websiteUrl: 'https://outletbooking.my',
});

describe('shared email template', () => {
  it('desktop Outlook gets a drawn (VML) button with the same link; other apps get the HTML button', () => {
    const url = 'https://outletbooking.my/admin/invite/abc?x=1&amp;y=2';
    expect(email.html).toContain('<!--[if mso]>');
    expect(email.html).toMatch(new RegExp(`<v:roundrect [^>]*href="${url.replace(/[?]/g, '\\?')}"[^>]*fillcolor="#0F7B55"`));
    expect(email.html).toContain('>Set my password</center>');
    expect(email.html).toContain('<!--[if !mso]><!-->');
    expect(email.html).toContain(`<a href="${url}" style="display:inline-block;padding:14px 22px;`);
    expect(email.html).toContain('xmlns:v="urn:schemas-microsoft-com:vml"');
  });

  it('Outlook uses Segoe UI; every text cell names the font (Outlook does not pass it down)', () => {
    expect(email.html).toContain("<style>body, table, td, a, center { font-family: 'Segoe UI', Arial, sans-serif !important; }</style>");
    const textCells = email.html.match(/<td style="[^"]*font-size:[^"]*"/g) ?? [];
    expect(textCells.length).toBeGreaterThanOrEqual(5);
    for (const cell of textCells) expect(cell).toContain('font-family:');
  });

  it('escapes content and keeps a plain-text version', () => {
    expect(email.html).toContain('Join &lt;the&gt; panel');
    expect(email.html).toContain('<b>Fadhil</b> added you.');
    expect(email.text).toContain('Set my password: https://outletbooking.my/admin/invite/abc?x=1&y=2');
    expect(email.text).toContain('Join <the> panel');
    expect(email.text).not.toMatch(/<(b|a|td|table|v:)[ >]/);
  });
});
