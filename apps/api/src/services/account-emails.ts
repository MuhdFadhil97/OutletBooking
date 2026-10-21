import { renderEmail, type RenderedEmail } from './email-template';

export const CHANGE_EMAIL_LINK_HOURS = 24;

/** H6 · Sent to the NEW address: the login email only switches after this link is opened. */
export function changeEmailEmail(name: string, newEmail: string, url: string, websiteUrl: string): RenderedEmail {
  return renderEmail({
    subject: 'Confirm your new OutletBooking email',
    preview: 'One tap to use this address for OutletBooking',
    heading: 'Confirm your new email',
    paragraphs: [
      ['Hi ', name, ', you asked to use ', { bold: newEmail }, ' to log in to OutletBooking.'],
      'Confirm it is yours. Until then, your current email keeps working.',
    ],
    button: { label: 'Confirm new email', url },
    notes: [`This link works once and expires in ${CHANGE_EMAIL_LINK_HOURS} hours.`],
    footer: 'You got this email because someone asked to change an OutletBooking login to this address. Not you? Ignore it — nothing changes.',
    websiteUrl,
  });
}

/** H6 · Sent to the OLD address after the change, so a hijacked account is noticed. */
export function emailChangedEmail(name: string, newEmail: string, forgotPasswordUrl: string, websiteUrl: string): RenderedEmail {
  return renderEmail({
    subject: 'Your OutletBooking email was changed',
    preview: 'Your login email now points to a new address',
    heading: 'Your login email was changed',
    paragraphs: [
      ['Hi ', name, ', the login email for your OutletBooking account is now ', { bold: newEmail }, '.'],
      'Didn’t do this? Reset your password right away and contact us on WhatsApp from the app’s Help section.',
    ],
    button: { label: 'Reset my password', url: forgotPasswordUrl },
    notes: ['If this was you, no action is needed.'],
    footer: 'Sent to your previous email address for your security.',
    websiteUrl,
  });
}
