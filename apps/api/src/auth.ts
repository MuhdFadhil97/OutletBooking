import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import { expo } from '@better-auth/expo';
import { accounts, sessions, twoFactors, users, verifications, type Db } from '@outletbooking/db';
import { ADMIN_LOCK_MINUTES, ADMIN_MAX_SIGN_IN_FAILURES } from '@outletbooking/shared';
import type { Env } from './env';
import { businessNameOf, CONFIRM_LINK_HOURS, confirmEmail } from './services/confirm-email';
import { createMailer, type Mailer } from './services/mailer';
import { RESET_LINK_MINUTES, resetPasswordEmail, resetPasswordUrl } from './services/password-emails';

export function createAuth(db: Db, env: Env, mailer: Mailer = createMailer(env)) {
  return betterAuth({
    appName: 'OutletBooking',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.TRUSTED_ORIGINS,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: users, session: sessions, account: accounts, verification: verifications, twoFactor: twoFactors },
    }),
    emailAndPassword: {
      enabled: true,
      // Owners sign up through POST /signup (user + business + trial in one transaction).
      disableSignUp: true,
      minPasswordLength: 8,
      // E1 → email → E2. The link opens the app's own reset screen, not Better Auth's redirect URL.
      resetPasswordTokenExpiresIn: RESET_LINK_MINUTES * 60,
      sendResetPassword: async ({ user, token }) => {
        const email = resetPasswordEmail(user.email, resetPasswordUrl(env.APP_PUBLIC_URL, token), env.WEBSITE_URL);
        await mailer.send({ to: user.email, ...email });
      },
    },
    // M1. Sign-up sends it from POST /signup (services/confirm-email.ts); this covers Better Auth's own
    // /send-verification-email. Confirming is not required to log in.
    emailVerification: {
      expiresIn: CONFIRM_LINK_HOURS * 3600,
      sendVerificationEmail: async ({ user, url }) => {
        const email = confirmEmail(user.name, await businessNameOf(db, Number(user.id)), url, env.WEBSITE_URL);
        await mailer.send({ to: user.email, ...email });
      },
    },
    user: {
      additionalFields: { phone: { type: 'string', required: false, input: false } },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days ("keep me logged in")
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      // Integer identity PKs — let Postgres generate the id.
      database: { generateId: 'serial' },
    },
    rateLimit: { enabled: env.NODE_ENV !== 'test' },
    plugins: [
      expo(),
      // I6: two-step sign-in (authenticator app + 10 backup codes). Only users who turned it on are asked
      // for a code, i.e. platform admins (required for them in requirePlatformAdmin); owners and staff are not.
      twoFactor({
        issuer: 'OutletBooking Admin',
        accountLockout: { maxFailedAttempts: ADMIN_MAX_SIGN_IN_FAILURES, durationSeconds: ADMIN_LOCK_MINUTES * 60 },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;
