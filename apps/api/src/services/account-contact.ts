import { and, eq, inArray } from 'drizzle-orm';
import { createEmailVerificationToken } from 'better-auth/api';
import { verifyPassword } from 'better-auth/crypto';
import { accounts, businesses, businessMembers, platformAdmins, users, type Db } from '@outletbooking/db';
import type { ChangeEmailInput, ChangePhoneInput } from '@outletbooking/shared';
import type { Env } from '../env';
import { AppError, forbidden, notFound } from '../errors';
import { CHANGE_EMAIL_LINK_HOURS, changeEmailEmail, emailChangedEmail } from './account-emails';
import type { Mailer } from './mailer';

type LinkEnv = Pick<Env, 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL' | 'APP_PUBLIC_URL' | 'WEBSITE_URL'>;

/** H6: change email / mobile re-types the password, like delete account. */
async function assertPassword(db: Db, userId: number, password: string) {
  const [credential] = await db
    .select({ hash: accounts.password })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')));
  if (!credential?.hash || !(await verifyPassword({ hash: credential.hash, password }))) {
    throw new AppError(400, 'invalid_password', 'Your password is not correct');
  }
}

/** Businesses this login owns: the only ones whose contact details follow the account. */
const ownedBusinessIds = (db: Pick<Db, 'select'>, userId: number) =>
  db
    .select({ id: businessMembers.businessId })
    .from(businessMembers)
    .where(and(eq(businessMembers.userId, userId), eq(businessMembers.role, 'owner')));

/**
 * H6 · Start changing the login email. Mails a confirm link to the NEW address; `users.email` only changes
 * when Better Auth's GET /api/auth/verify-email handles that link (a "change-email-verification" token).
 */
export async function requestEmailChange(db: Db, mailer: Mailer, env: LinkEnv, userId: number, input: ChangeEmailInput) {
  const [user] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
  if (!user) throw notFound('User');

  // Platform admins sign in with a second step and their email feeds the authenticator; FTech changes it for them.
  const [admin] = await db
    .select({ id: platformAdmins.id })
    .from(platformAdmins)
    .where(and(eq(platformAdmins.userId, userId), eq(platformAdmins.isActive, true)));
  if (admin) throw forbidden('This account cannot change its email here');

  await assertPassword(db, userId, input.currentPassword);
  if (input.email === user.email.toLowerCase()) throw new AppError(400, 'same_email', 'This is already your email');
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
  if (taken) throw new AppError(409, 'email_taken', 'An account with this email already exists');

  const token = await createEmailVerificationToken(env.BETTER_AUTH_SECRET, user.email, input.email, CHANGE_EMAIL_LINK_HOURS * 3600, {
    requestType: 'change-email-verification',
  });
  const url = new URL('/api/auth/verify-email', env.BETTER_AUTH_URL);
  url.searchParams.set('token', token);
  url.searchParams.set('callbackURL', env.APP_PUBLIC_URL);
  await mailer.send({
    to: input.email,
    ...changeEmailEmail(user.name, input.email, url.toString(), env.WEBSITE_URL),
    meta: { template: 'change_email', userId },
  });
}

/** The old and new address of a change-email link, read from its (already verified) token. */
export function emailChangeOfLink(request: Request | undefined): { from: string; to: string } | null {
  const token = request ? new URL(request.url).searchParams.get('token') : null;
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: unknown; updateTo?: unknown };
    return typeof claims.email === 'string' && typeof claims.updateTo === 'string' ? { from: claims.email, to: claims.updateTo } : null;
  } catch {
    return null;
  }
}

/**
 * After the new address confirmed: the business contact email follows if it was the old login email,
 * and the old address gets a notice.
 */
export async function afterEmailChanged(
  db: Db,
  mailer: Mailer,
  env: Pick<Env, 'APP_PUBLIC_URL' | 'WEBSITE_URL'>,
  user: { id: number; name: string },
  change: { from: string; to: string },
) {
  await db
    .update(businesses)
    .set({ email: change.to })
    .where(and(eq(businesses.email, change.from), inArray(businesses.id, ownedBusinessIds(db, user.id))));
  const forgot = new URL('/forgot-password', env.APP_PUBLIC_URL).toString();
  await mailer.send({
    to: change.from,
    ...emailChangedEmail(user.name, change.to, forgot, env.WEBSITE_URL),
    meta: { template: 'email_changed', userId: user.id },
  });
}

/** H6 · Change my mobile number. The business phone / WhatsApp number follow only if they matched the old one. */
export async function changePhone(db: Db, userId: number, input: ChangePhoneInput) {
  await assertPassword(db, userId, input.currentPassword);
  await db.transaction(async (tx) => {
    const [user] = await tx.select({ phone: users.phone }).from(users).where(eq(users.id, userId));
    if (!user) throw notFound('User');
    await tx.update(users).set({ phone: input.phone }).where(eq(users.id, userId));
    const old = user.phone;
    if (!old || old === input.phone) return;
    const mine = inArray(businesses.id, ownedBusinessIds(tx, userId));
    await tx.update(businesses).set({ phone: input.phone }).where(and(eq(businesses.phone, old), mine));
    await tx.update(businesses).set({ whatsappPhone: input.phone }).where(and(eq(businesses.whatsappPhone, old), mine));
  });
}
