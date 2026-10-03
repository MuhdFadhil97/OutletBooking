import { hashPassword } from 'better-auth/crypto';
import { accounts, applyTemplate, businesses, businessMembers, subscriptions, users, type Db } from '@outletbooking/db';
import { TEMPLATE_INFO, type SignupInput } from '@outletbooking/shared';
import { AppError, pgErrorInfo } from '../errors';
import { isReservedSlug } from './slugs';

export const TRIAL_DAYS = 7;

export interface SignupResult {
  userId: number;
  businessId: number;
  slug: string;
  trialEndsAt: Date;
}

/**
 * Creates user + credential account + business + owner membership + 7-day trial
 * + template sample services / booking fields in ONE transaction. Any failure (e.g. slug or email taken) rolls everything back.
 *
 * We insert the Better Auth rows ourselves (same password hasher) because Better
 * Auth's own sign-up cannot join our transaction. The client signs in afterwards.
 */
export async function signupOwner(db: Db, input: SignupInput, now: Date = new Date()): Promise<SignupResult> {
  if (isReservedSlug(input.slug)) {
    throw new AppError(409, 'slug_taken', 'That booking link is not available');
  }
  const passwordHash = await hashPassword(input.password);
  const template = TEMPLATE_INFO[input.template];
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ name: input.name, email: input.email, phone: input.phone })
        .returning({ id: users.id });
      if (!user) throw new Error('user insert returned no row');

      await tx.insert(accounts).values({
        userId: user.id,
        accountId: String(user.id),
        providerId: 'credential',
        password: passwordHash,
      });

      const [business] = await tx
        .insert(businesses)
        .values({
          slug: input.slug,
          name: input.businessName,
          template: input.template,
          phone: input.phone,
          whatsappPhone: input.phone,
          email: input.email,
          resourceLabel: template.resourceLabel,
          slotIntervalMin: template.slotIntervalMin,
        })
        .returning({ id: businesses.id, slug: businesses.slug });
      if (!business) throw new Error('business insert returned no row');

      await applyTemplate(tx, business.id, input.template);

      await tx
        .insert(businessMembers)
        .values({ businessId: business.id, userId: user.id, role: 'owner', canViewAll: true });

      await tx.insert(subscriptions).values({
        businessId: business.id,
        plan: 'trial',
        status: 'trialing',
        trialEndsAt,
      });

      return { userId: user.id, businessId: business.id, slug: business.slug, trialEndsAt };
    });
  } catch (err) {
    const { code, constraint } = pgErrorInfo(err);
    if (code === '23505' && constraint === 'users_email_unique') {
      throw new AppError(409, 'email_taken', 'An account with this email already exists');
    }
    if (code === '23505' && constraint === 'businesses_slug_unique') {
      throw new AppError(409, 'slug_taken', 'That booking link is already taken');
    }
    throw err;
  }
}
