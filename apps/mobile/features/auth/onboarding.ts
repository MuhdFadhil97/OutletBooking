/**
 * Sign-up step 3 ("Review your services") runs after the account exists, so it is an owner
 * screen (`/welcome`), not part of the (auth) stack — that stack redirects to `/` as soon as
 * the new session appears. Sign-up sets this flag before logging in; the role router (`/`)
 * sends the owner to `/welcome` while it is set, and the welcome screen clears it.
 * In memory only: if the app is closed mid-way the owner simply lands on Today.
 */
let pending = false;

export const markOnboardingPending = () => {
  pending = true;
};
export const isOnboardingPending = () => pending;
export const clearOnboardingPending = () => {
  pending = false;
};
