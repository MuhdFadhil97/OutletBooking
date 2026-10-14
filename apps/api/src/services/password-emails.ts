import { renderEmail, type RenderedEmail } from './email-template';

/** Reset links open E2 (`/reset-password`) on the app's web build; the app handles the same path. */
export function resetPasswordUrl(appPublicUrl: string, token: string): string {
  const url = new URL('/reset-password', appPublicUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

export const RESET_LINK_MINUTES = 30;

/** M2 · Reset your password (docs/wireframes/Email-Reset.dc.html). */
export function resetPasswordEmail(email: string, url: string, websiteUrl: string): RenderedEmail {
  return renderEmail({
    subject: 'Reset your OutletBooking password',
    preview: 'Set a new password for OutletBooking',
    heading: 'Reset your password',
    paragraphs: [['We got a request to reset the password for ', { bold: email }, '.']],
    button: { label: 'Set a new password', url },
    notes: [
      `This link works once and expires in ${RESET_LINK_MINUTES} minutes.`,
      'Didn’t ask for this? You can ignore this email — your password stays the same.',
    ],
    footer: 'Sent because a password reset was requested in the OutletBooking app.',
    websiteUrl,
  });
}
