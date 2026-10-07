/** Reset links open E2 (`/reset-password`) on the app's web build; the app handles the same path. */
export function resetPasswordUrl(appPublicUrl: string, token: string): string {
  const url = new URL('/reset-password', appPublicUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

export const RESET_LINK_MINUTES = 30;

export function resetPasswordEmail(name: string, url: string) {
  return {
    subject: 'Reset your OutletBooking password',
    text: [
      `Hi ${name},`,
      '',
      'Someone (hopefully you) asked to reset the password for your OutletBooking account.',
      `Open this link to choose a new password. It works for ${RESET_LINK_MINUTES} minutes:`,
      '',
      url,
      '',
      "If you didn't ask for this, ignore this email — your password stays the same.",
    ].join('\n'),
  };
}
