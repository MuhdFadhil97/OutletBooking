import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { expo } from '@better-auth/expo';
import { accounts, sessions, users, verifications, type Db } from '@outletbooking/db';
import type { Env } from './env';
import { createMailer, type Mailer } from './services/mailer';
import { RESET_LINK_MINUTES, resetPasswordEmail, resetPasswordUrl } from './services/password-emails';

export function createAuth(db: Db, env: Env, mailer: Mailer = createMailer(env.MAIL_TRANSPORT, env.NODE_ENV)) {
  return betterAuth({
    appName: 'OutletBooking',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.TRUSTED_ORIGINS,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    emailAndPassword: {
      enabled: true,
      // Owners sign up through POST /signup (user + business + trial in one transaction).
      disableSignUp: true,
      minPasswordLength: 8,
      // E1 → email → E2. The link opens the app's own reset screen, not Better Auth's redirect URL.
      resetPasswordTokenExpiresIn: RESET_LINK_MINUTES * 60,
      sendResetPassword: async ({ user, token }) => {
        const email = resetPasswordEmail(user.name, resetPasswordUrl(env.APP_PUBLIC_URL, token));
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
    plugins: [expo()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;
