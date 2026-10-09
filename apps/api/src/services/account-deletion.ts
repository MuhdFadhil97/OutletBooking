import { and, eq, inArray, isNull, notExists } from 'drizzle-orm';
import { verifyPassword } from 'better-auth/crypto';
import { accounts, bookings, businesses, businessMembers, refunds, users, type Db } from '@outletbooking/db';
import type { DeleteAccountInput } from '@outletbooking/shared';
import { AppError, notFound } from '../errors';
import { businessPrefix, type ObjectStorage } from './storage';

/**
 * H6 · Delete my account and business data (owner only, permanent — decided by the product owner).
 * In one transaction:
 *  1. rows that RESTRICT the business delete: refunds, then bookings (booking_events cascade);
 *  2. the business — everything else cascades (customers, services, resources, hours, time off,
 *     booking questions, members, invitations, subscription);
 *  3. logins left without any business: the owner and staff who only worked here
 *     (sessions and credentials cascade).
 * Tables added later with ON DELETE RESTRICT to businesses / bookings (e.g. Phase 5 `payments`)
 * must be deleted in step 1 too.
 * Afterwards the business's files (S2 photos) are removed from storage.
 */
export async function deleteOwnerAccount(
  db: Db,
  businessId: number,
  ownerUserId: number,
  input: DeleteAccountInput,
  storage: ObjectStorage | null = null,
) {
  const [biz] = await db
    .select({ name: businesses.name })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), isNull(businesses.deletedAt)));
  if (!biz) throw notFound('Business');
  if (normalise(input.confirmBusinessName) !== normalise(biz.name)) {
    throw new AppError(400, 'confirmation_mismatch', 'Type your business name exactly as shown to confirm');
  }

  const [credential] = await db
    .select({ hash: accounts.password })
    .from(accounts)
    .where(and(eq(accounts.userId, ownerUserId), eq(accounts.providerId, 'credential')));
  if (!credential?.hash || !(await verifyPassword({ hash: credential.hash, password: input.password }))) {
    throw new AppError(400, 'invalid_password', 'Your password is not correct');
  }

  await db.transaction(async (tx) => {
    const memberIds = (
      await tx.select({ userId: businessMembers.userId }).from(businessMembers).where(eq(businessMembers.businessId, businessId))
    ).map((m) => m.userId);

    await tx.delete(refunds).where(eq(refunds.businessId, businessId));
    await tx.delete(bookings).where(eq(bookings.businessId, businessId));
    await tx.delete(businesses).where(eq(businesses.id, businessId));

    // Logins that no longer belong to any business (always includes the owner).
    const userIds = [...new Set([ownerUserId, ...memberIds])];
    await tx
      .delete(users)
      .where(
        and(
          inArray(users.id, userIds),
          notExists(tx.select({ id: businessMembers.id }).from(businessMembers).where(eq(businessMembers.userId, users.id))),
        ),
      );
  });

  // The rows are gone already; a storage hiccup must not fail the delete (files are unreachable without them).
  await storage?.removePrefix(businessPrefix(businessId)).catch((err: unknown) => {
    console.error(`[account-deletion] could not remove files of business ${businessId}`, err);
  });
}

const normalise = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
