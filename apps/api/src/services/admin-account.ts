import { createOTP } from '@better-auth/utils/otp';
import { generateRandomString, hashPassword, symmetricDecrypt, symmetricEncrypt, verifyPassword } from 'better-auth/crypto';
import { and, desc, eq, gt, ne } from 'drizzle-orm';
import { accounts, adminAuditLog, sessions, twoFactors, users, verifications, type Db, type Tx } from '@outletbooking/db';
import {
  ADMIN_ACCOUNT_ERRORS,
  ADMIN_AUTH_ERRORS,
  ADMIN_BACKUP_CODE_COUNT,
  ADMIN_LOCK_MINUTES,
  ADMIN_MOVE_PHONE_MINUTES,
  ADMIN_USER_ERRORS,
  type AdminAccount,
  type AdminAction,
  type AdminMe,
  type ChangeAdminPasswordInput,
} from '@outletbooking/shared';
import type { Auth } from '../auth';
import { AppError, notFound } from '../errors';
import {
  adminLockedUntil,
  clearAdminPasswordFailures,
  recordAdminPasswordFailure,
  type SignInMeta,
} from './admin-sign-in';
import { describeDevice } from './device';

/**
 * I29 · My account (every admin, only their own account). Password, backup codes, moving two-step to a
 * new phone, and signed-in devices. Every change writes admin_audit_log in the same transaction.
 *
 * Better Auth owns the two-step secret. It refuses to enable two-step again while a verified secret exists,
 * so "move to a new phone" is done here with the same primitives Better Auth uses (its own secret
 * encryption, the same TOTP settings). The old phone keeps working until the new one proves it works.
 */

const TOTP = { digits: 6, period: 30 } as const;
const ISSUER = 'OutletBooking Admin';
/** Wrong codes from the new phone before the pending setup is thrown away. */
const MAX_MOVE_ATTEMPTS = 5;

const moveKey = (userId: number) => `admin-2fa-move:${userId}`;

async function secretConfig(auth: Auth) {
  return (await auth.$context).secretConfig;
}

/**
 * Ten backup codes in the format Better Auth makes and reads ("ab1Cd-2eF3g"), stored as its encrypted JSON
 * list. Better Auth does not export its generator at runtime, so this uses its public crypto helpers.
 * The sign-in tests prove Better Auth accepts these codes.
 */
async function makeBackupCodes(auth: Auth) {
  const backupCodes = Array.from({ length: ADMIN_BACKUP_CODE_COUNT }, () => {
    const code = generateRandomString(10, 'a-z', '0-9', 'A-Z');
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
  const encryptedBackupCodes = await symmetricEncrypt({ key: await secretConfig(auth), data: JSON.stringify(backupCodes) });
  return { backupCodes, encryptedBackupCodes };
}

async function audit(
  tx: Tx,
  adminUserId: number,
  action: AdminAction,
  reason: string,
  details: Record<string, string | number | boolean | null> = {},
) {
  await tx.insert(adminAuditLog).values({ adminUserId, businessId: null, action, reason, details });
}

const lockedError = () =>
  new AppError(
    429,
    ADMIN_AUTH_ERRORS.accountLocked,
    `Too many wrong tries. This admin login is locked for ${ADMIN_LOCK_MINUTES} minutes.`,
  );

/**
 * The admin's password, asked again before a sensitive change. Wrong tries count towards the same
 * 5-tries lockout as signing in, so a stolen session cannot be used to guess the password.
 */
async function confirmPassword(db: Db, userId: number, password: string, meta: SignInMeta): Promise<void> {
  if (await adminLockedUntil(db, userId)) throw lockedError();
  const [account] = await db
    .select({ hash: accounts.password })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
    .limit(1);
  const ok = !!account?.hash && (await verifyPassword({ hash: account.hash, password }));
  if (ok) {
    await clearAdminPasswordFailures(db, userId);
    return;
  }
  if (await recordAdminPasswordFailure(db, userId, meta, 'account')) throw lockedError();
  throw new AppError(400, ADMIN_ACCOUNT_ERRORS.wrongPassword, 'That password is not right');
}

/** GET /admin/account */
export async function getAdminAccount(
  db: Db,
  auth: Auth,
  me: AdminMe,
  currentSessionId: number,
  now: Date = new Date(),
): Promise<AdminAccount> {
  const [[user], rows, left] = await Promise.all([
    db.select({ twoFactorEnabled: users.twoFactorEnabled }).from(users).where(eq(users.id, me.userId)).limit(1),
    db
      .select({
        id: sessions.id,
        userAgent: sessions.userAgent,
        ipAddress: sessions.ipAddress,
        createdAt: sessions.createdAt,
        updatedAt: sessions.updatedAt,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, me.userId), gt(sessions.expiresAt, now)))
      .orderBy(desc(sessions.updatedAt)),
    backupCodesLeft(auth, me.userId),
  ]);
  return {
    name: me.name,
    email: me.email,
    role: me.role,
    twoFactorEnabled: user?.twoFactorEnabled ?? false,
    backupCodesLeft: left,
    backupCodesTotal: ADMIN_BACKUP_CODE_COUNT,
    devices: rows.map((r) => ({
      id: r.id,
      current: r.id === currentSessionId,
      device: describeDevice(r.userAgent),
      ipAddress: r.ipAddress,
      signedInAt: r.createdAt.toISOString(),
      lastActiveAt: r.updatedAt.toISOString(),
    })),
  };
}

/** Unused backup codes (Better Auth removes a code from the list when it is used). */
async function backupCodesLeft(auth: Auth, userId: number): Promise<number> {
  try {
    const res = await auth.api.viewBackupCodes({ body: { userId: String(userId) } });
    return res.backupCodes.length;
  } catch {
    return 0;
  }
}

/**
 * Change the password (12+ characters). The other devices are signed out, so a password that may have
 * leaked stops working everywhere else at once.
 */
export async function changeAdminPassword(
  db: Db,
  userId: number,
  currentSessionId: number,
  input: ChangeAdminPasswordInput,
  meta: SignInMeta,
): Promise<{ signedOutDevices: number }> {
  await confirmPassword(db, userId, input.currentPassword, meta);
  if (input.newPassword === input.currentPassword) {
    throw new AppError(400, 'same_password', 'Choose a different password from the current one');
  }
  const hash = await hashPassword(input.newPassword);
  return db.transaction(async (tx) => {
    await tx
      .update(accounts)
      .set({ password: hash })
      .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')));
    const gone = await tx
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)))
      .returning({ id: sessions.id });
    await audit(tx, userId, 'change_password', 'Changed own password', { signedOutDevices: gone.length });
    return { signedOutDevices: gone.length };
  });
}

/** Ten new backup codes; the old ones stop working. Shown once, never stored in the clear. */
export async function makeNewBackupCodes(db: Db, auth: Auth, userId: number, password: string, meta: SignInMeta) {
  await confirmPassword(db, userId, password, meta);
  const fresh = await makeBackupCodes(auth);
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(twoFactors)
      .set({ backupCodes: fresh.encryptedBackupCodes })
      .where(eq(twoFactors.userId, userId))
      .returning({ id: twoFactors.id });
    if (updated.length === 0) throw new AppError(409, 'two_factor_not_set_up', 'Two-step sign-in is not set up');
    await audit(tx, userId, 'new_backup_codes', 'Made new backup codes');
  });
  return { backupCodes: fresh.backupCodes };
}

/** What `value` of the pending "move to a new phone" row holds. */
interface PendingMove {
  /** The new secret, encrypted the way Better Auth stores secrets. */
  secret: string;
  attempts: number;
}

/**
 * Step 1 of "Move to a new phone": after the password, a new secret and its QR code. Nothing changes for
 * sign-in yet; the old phone keeps working until `confirmMovePhone` succeeds.
 */
export async function startMovePhone(db: Db, auth: Auth, me: AdminMe, password: string, meta: SignInMeta, now: Date = new Date()) {
  await confirmPassword(db, me.userId, password, meta);
  const [existing] = await db
    .select({ id: twoFactors.id })
    .from(twoFactors)
    .where(and(eq(twoFactors.userId, me.userId), eq(twoFactors.verified, true)))
    .limit(1);
  if (!existing) throw new AppError(409, 'two_factor_not_set_up', 'Two-step sign-in is not set up');

  const secret = generateRandomString(32);
  const pending: PendingMove = { secret: await symmetricEncrypt({ key: await secretConfig(auth), data: secret }), attempts: 0 };
  const expiresAt = new Date(now.getTime() + ADMIN_MOVE_PHONE_MINUTES * 60_000);
  await db.transaction(async (tx) => {
    await tx.delete(verifications).where(eq(verifications.identifier, moveKey(me.userId)));
    await tx.insert(verifications).values({ identifier: moveKey(me.userId), value: JSON.stringify(pending), expiresAt });
  });
  return { totpUri: createOTP(secret, TOTP).url(ISSUER, me.email), expiresAt: expiresAt.toISOString() };
}

/**
 * Step 2: the 6-digit code from the NEW phone. Right → the stored secret is replaced, new backup codes are
 * made, and the other devices are signed out. Wrong 5 times → the setup is thrown away (start again).
 */
export async function confirmMovePhone(
  db: Db,
  auth: Auth,
  userId: number,
  currentSessionId: number,
  code: string,
  now: Date = new Date(),
) {
  const [row] = await db
    .select({ id: verifications.id, value: verifications.value, expiresAt: verifications.expiresAt })
    .from(verifications)
    .where(eq(verifications.identifier, moveKey(userId)))
    .limit(1);
  if (!row || row.expiresAt <= now) {
    throw new AppError(410, ADMIN_ACCOUNT_ERRORS.moveExpired, 'This setup timed out. Start again to get a new QR code.');
  }
  const pending = JSON.parse(row.value) as PendingMove;
  const key = await secretConfig(auth);
  const secret = await symmetricDecrypt({ key, data: pending.secret });

  const valid = await createOTP(secret, TOTP).verify(code);
  if (!valid) {
    const attempts = pending.attempts + 1;
    if (attempts >= MAX_MOVE_ATTEMPTS) {
      await db.delete(verifications).where(eq(verifications.id, row.id));
      throw new AppError(410, ADMIN_ACCOUNT_ERRORS.moveExpired, 'Too many wrong codes. Start again to get a new QR code.');
    }
    await db.update(verifications).set({ value: JSON.stringify({ ...pending, attempts }) }).where(eq(verifications.id, row.id));
    throw new AppError(400, ADMIN_ACCOUNT_ERRORS.wrongCode, 'That code is not right. Check the time on your phone and try again.');
  }

  const fresh = await makeBackupCodes(auth);
  const signedOut = await db.transaction(async (tx) => {
    const updated = await tx
      .update(twoFactors)
      .set({
        secret: pending.secret,
        backupCodes: fresh.encryptedBackupCodes,
        verified: true,
        failedVerificationCount: 0,
        lockedUntil: null,
      })
      .where(eq(twoFactors.userId, userId))
      .returning({ id: twoFactors.id });
    if (updated.length === 0) throw notFound('Two-step sign-in');
    await tx.delete(verifications).where(eq(verifications.id, row.id));
    const gone = await tx
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)))
      .returning({ id: sessions.id });
    await audit(tx, userId, 'move_two_factor', 'Moved two-step sign-in to a new phone', { signedOutDevices: gone.length });
    return gone.length;
  });
  return { backupCodes: fresh.backupCodes, signedOutDevices: signedOut };
}

/** Sign out one other device. Your own session is not signed out here (use Sign out). */
export async function signOutDevice(db: Db, userId: number, currentSessionId: number, sessionId: number): Promise<void> {
  if (sessionId === currentSessionId) {
    throw new AppError(409, ADMIN_USER_ERRORS.notYourself, 'This is the device you are using now. Use Sign out instead.');
  }
  await db.transaction(async (tx) => {
    const gone = await tx
      .delete(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
      .returning({ id: sessions.id });
    if (gone.length === 0) throw notFound('Device');
    await audit(tx, userId, 'sign_out_devices', 'Signed out a device', { count: 1 });
  });
}

/** Sign out every other device; returns how many were signed out. */
export async function signOutOtherDevices(db: Db, userId: number, currentSessionId: number): Promise<number> {
  return db.transaction(async (tx) => {
    const gone = await tx
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)))
      .returning({ id: sessions.id });
    if (gone.length > 0) await audit(tx, userId, 'sign_out_devices', 'Signed out all other devices', { count: gone.length });
    return gone.length;
  });
}
