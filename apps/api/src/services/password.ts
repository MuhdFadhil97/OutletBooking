import { APIError } from 'better-auth/api';
import type { ResetPasswordInput, ResetTokenInfo } from '@outletbooking/shared';
import type { Auth } from '../auth';
import { AppError } from '../errors';

const invalidResetLink = () =>
  new AppError(400, 'invalid_reset_link', 'This reset link is invalid or has expired. Ask for a new one.');

/** Better Auth stores reset tokens as verification rows under this identifier. */
const resetIdentifier = (token: string) => `reset-password:${token}`;

async function findResetUser(auth: Auth, token: string) {
  const ctx = await auth.$context;
  const verification = await ctx.internalAdapter.findVerificationValue(resetIdentifier(token));
  if (!verification || verification.expiresAt < new Date()) throw invalidResetLink();
  const user = await ctx.internalAdapter.findUserById(verification.value);
  if (!user) throw invalidResetLink();
  return user;
}

/**
 * E1: emails a reset link (30 min). Always succeeds so the response never
 * reveals whether an email has an account.
 */
export async function requestPasswordReset(auth: Auth, email: string, headers: Headers): Promise<void> {
  await auth.api.requestPasswordReset({ body: { email }, headers });
}

/** E2 header: "For owner@…". Only someone holding the emailed token can call this. */
export async function getResetTokenInfo(auth: Auth, token: string): Promise<ResetTokenInfo> {
  const user = await findResetUser(auth, token);
  return { email: user.email };
}

/**
 * E2: sets the new password (token is single-use). With `logoutOtherDevices`
 * every existing session is revoked; the app then logs in with the new password.
 */
export async function resetPassword(auth: Auth, input: ResetPasswordInput): Promise<ResetTokenInfo> {
  const user = await findResetUser(auth, input.token);
  try {
    await auth.api.resetPassword({ body: { token: input.token, newPassword: input.newPassword } });
  } catch (err) {
    if (err instanceof APIError) throw invalidResetLink();
    throw err;
  }
  if (input.logoutOtherDevices ?? true) {
    const ctx = await auth.$context;
    await ctx.internalAdapter.deleteUserSessions(user.id);
  }
  return { email: user.email };
}
