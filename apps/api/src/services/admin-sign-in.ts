import { and, eq, inArray, sql } from 'drizzle-orm';
import { adminAuditLog, platformAdmins, sessions, users, verifications, type Db } from '@outletbooking/db';
import { ADMIN_LOCK_MINUTES, ADMIN_MAX_SIGN_IN_FAILURES } from '@outletbooking/shared';

/**
 * I5 / I6 admin sign-in rules on top of Better Auth:
 * - 5 wrong passwords in a row lock the admin login for 15 minutes (wrong two-step codes are counted
 *   by Better Auth's own lockout on `two_factors`);
 * - every admin sign-in and wrong password is written to admin_audit_log (FR-20.1).
 * The failure counter lives in Better Auth's `verifications` table (key-value with expiry), one row per admin.
 */

const LOCK_MS = ADMIN_LOCK_MINUTES * 60_000;
const failureKey = (userId: number) => `admin-sign-in-failures-${userId}`;

export interface SignInMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Active platform admin with this login email, or null (owners and staff are not affected). */
export async function findAdminIdByEmail(db: Db, email: string): Promise<number | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(platformAdmins, eq(platformAdmins.userId, users.id))
    .where(and(eq(users.email, email), eq(platformAdmins.isActive, true)))
    .limit(1);
  return row?.id ?? null;
}

export async function isPlatformAdmin(db: Db, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: platformAdmins.id })
    .from(platformAdmins)
    .where(and(eq(platformAdmins.userId, userId), eq(platformAdmins.isActive, true)))
    .limit(1);
  return !!row;
}

/** When the admin login unlocks, or null when it is not locked. */
export async function adminLockedUntil(db: Db, userId: number, now = new Date()): Promise<Date | null> {
  const [row] = await db
    .select({ value: verifications.value, expiresAt: verifications.expiresAt })
    .from(verifications)
    .where(eq(verifications.identifier, failureKey(userId)))
    .limit(1);
  if (!row || row.expiresAt <= now || Number(row.value) < ADMIN_MAX_SIGN_IN_FAILURES) return null;
  return row.expiresAt;
}

/** Counts a wrong password (the count resets 15 minutes after the last one). Returns true when now locked. */
export async function recordAdminPasswordFailure(
  db: Db,
  userId: number,
  meta: SignInMeta,
  /** `account` = the password was asked again inside My account (I29), not at sign-in. */
  context: 'sign_in' | 'account' = 'sign_in',
): Promise<boolean> {
  return db.transaction(async (tx) => {
    // One counter row per admin; serialise concurrent wrong passwords.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('admin-sign-in'), ${userId})`);
    const now = new Date();
    const [row] = await tx
      .select({ id: verifications.id, value: verifications.value, expiresAt: verifications.expiresAt })
      .from(verifications)
      .where(eq(verifications.identifier, failureKey(userId)))
      .limit(1);
    const failures = (row && row.expiresAt > now ? Number(row.value) || 0 : 0) + 1;
    const expiresAt = new Date(now.getTime() + LOCK_MS);
    if (row) {
      await tx.update(verifications).set({ value: String(failures), expiresAt }).where(eq(verifications.id, row.id));
    } else {
      await tx.insert(verifications).values({ identifier: failureKey(userId), value: String(failures), expiresAt });
    }
    const locked = failures >= ADMIN_MAX_SIGN_IN_FAILURES;
    await tx.insert(adminAuditLog).values({
      adminUserId: userId,
      action: 'sign_in_failed',
      reason: locked
        ? `Wrong password ${failures} times — locked for ${ADMIN_LOCK_MINUTES} minutes`
        : context === 'account'
          ? 'Wrong password in My account'
          : 'Wrong password',
      details: { step: context === 'account' ? 'account' : 'password', failures, locked, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null },
    });
    return locked;
  });
}

export async function clearAdminPasswordFailures(db: Db, userId: number): Promise<void> {
  await db.delete(verifications).where(eq(verifications.identifier, failureKey(userId)));
}

export async function sessionIdsOf(db: Db, userId: number): Promise<number[]> {
  const rows = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId));
  return rows.map((r) => r.id);
}

/**
 * A full admin session was created with a two-step code (or two-step was just set up).
 * After first setup, the sessions made before two-step was on (`revokeSessionIds`, e.g. the owner app)
 * are signed out, so every admin session left has passed the two-step check.
 */
export async function recordAdminSignIn(
  db: Db,
  userId: number,
  input: SignInMeta & { method: 'totp' | 'backup_code'; firstSetup: boolean; revokeSessionIds: number[] },
): Promise<void> {
  await db.transaction(async (tx) => {
    if (input.revokeSessionIds.length) {
      await tx.delete(sessions).where(and(eq(sessions.userId, userId), inArray(sessions.id, input.revokeSessionIds)));
    }
    await tx.insert(adminAuditLog).values({
      adminUserId: userId,
      action: 'sign_in',
      reason: input.firstSetup
        ? 'Signed in and set up two-step sign-in'
        : input.method === 'backup_code'
          ? 'Signed in with a backup code'
          : 'Signed in with a two-step code',
      details: {
        method: input.method,
        firstSetup: input.firstSetup,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  });
}
