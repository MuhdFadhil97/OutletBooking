import { and, asc, eq, sql } from 'drizzle-orm';
import { createEmailVerificationToken } from 'better-auth/api';
import { businesses, businessMembers, users, type Db } from '@outletbooking/db';
import type { Env } from '../env';
import { renderEmail, type RenderedEmail } from './email-template';
import type { Mailer } from './mailer';

export const CONFIRM_LINK_HOURS = 24;

type LinkEnv = Pick<Env, 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL' | 'APP_PUBLIC_URL'>;

/**
 * Better Auth's own verify link (GET /api/auth/verify-email): it sets `users.email_verified` and then
 * opens the app (O2 Today, or log in). An expired link opens the app with `?error=TOKEN_EXPIRED`.
 */
export async function confirmEmailUrl(env: LinkEnv, email: string): Promise<string> {
  const token = await createEmailVerificationToken(env.BETTER_AUTH_SECRET, email, undefined, CONFIRM_LINK_HOURS * 3600);
  const url = new URL('/api/auth/verify-email', env.BETTER_AUTH_URL);
  url.searchParams.set('token', token);
  url.searchParams.set('callbackURL', env.APP_PUBLIC_URL);
  return url.toString();
}

/** M1 · Confirm your email, sent after sign-up (docs/wireframes/Email-Verify.dc.html). */
export function confirmEmail(name: string, businessName: string | null, url: string, websiteUrl: string): RenderedEmail {
  return renderEmail({
    subject: 'Confirm your email',
    preview: 'One tap to finish setting up OutletBooking',
    heading: 'Confirm your email',
    paragraphs: [
      businessName ? [`Hi ${name}, thanks for starting your free trial for `, { bold: businessName }, '.'] : `Hi ${name}, thanks for joining OutletBooking.`,
      'Confirm this is your email so we can send your receipts and password resets here.',
    ],
    button: { label: 'Confirm email', url },
    notes: [`This link expires in ${CONFIRM_LINK_HOURS} hours.`],
    footer: 'You got this email because someone signed up for OutletBooking with this address. Not you? Ignore it — nothing happens.',
    websiteUrl,
  });
}

/** The business this person owns (or works at), for the greeting. */
export async function businessNameOf(db: Db, userId: number): Promise<string | null> {
  const [row] = await db
    .select({ name: businesses.name })
    .from(businessMembers)
    .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
    .where(and(eq(businessMembers.userId, userId), eq(businessMembers.isActive, true)))
    .orderBy(sql`${businessMembers.role} = 'owner' desc`, asc(businessMembers.id))
    .limit(1);
  return row?.name ?? null;
}

/** Sends M1 to a user. Returns false (nothing sent) when the email is already confirmed. */
export async function sendConfirmEmail(db: Db, mailer: Mailer, env: LinkEnv & Pick<Env, 'WEBSITE_URL'>, userId: number): Promise<boolean> {
  const [user] = await db
    .select({ name: users.name, email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId));
  if (!user || user.emailVerified) return false;
  const url = await confirmEmailUrl(env, user.email);
  const email = confirmEmail(user.name, await businessNameOf(db, userId), url, env.WEBSITE_URL);
  await mailer.send({ to: user.email, ...email, meta: { template: 'verify_email', userId } });
  return true;
}
