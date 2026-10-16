import { randomBytes } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { and, asc, desc, eq, like, sql } from 'drizzle-orm';
import {
  accounts,
  adminAuditLog,
  businessMembers,
  platformAdmins,
  sessions,
  twoFactors,
  users,
  verifications,
  type Db,
  type Tx,
} from '@outletbooking/db';
import {
  ADMIN_INVITE_DAYS,
  ADMIN_USER_ERRORS,
  type AcceptAdminInviteInput,
  type AdminAction,
  type AdminInviteInfo,
  type AdminRole,
  type AdminUserRow,
  type ChangeAdminRoleInput,
  type InviteAdminInput,
} from '@outletbooking/shared';
import { renderEmail, type RenderedEmail } from './email-template';
import type { Mailer } from './mailer';
import { AppError, notFound } from '../errors';

/**
 * I10 · Admin users (super admins only). An invite creates the login without a password plus a
 * platform_admins row; the one-time link (Better Auth's `verifications` table, like the sign-in lockout
 * counter) lets them set a name and password at /admin/invite/<token>. Their first sign-in then sets up
 * two-step (I6). Every change writes admin_audit_log in the same transaction (rule 17).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const INVITE_PREFIX = 'admin-invite:';
const inviteKey = (token: string) => `${INVITE_PREFIX}${token}`;

const toRole = (role: string): AdminRole => (role === 'super_admin' ? 'super_admin' : 'support');

export interface AdminUsersEnv {
  WEBSITE_URL: string;
}

export const adminInviteUrl = (websiteUrl: string, token: string) => new URL(`/admin/invite/${token}`, websiteUrl).toString();

/** Invite email (one shared template, like M1–M6). */
export function adminInviteEmail(inviter: string, role: AdminRole, url: string, websiteUrl: string): RenderedEmail {
  const roleName = role === 'super_admin' ? 'Super admin' : 'Support';
  return renderEmail({
    subject: 'You’re invited to the OutletBooking admin panel',
    preview: `${inviter} added you as ${roleName}`,
    heading: 'Join the OutletBooking admin panel',
    paragraphs: [[{ bold: inviter }, ' added you as ', { bold: roleName }, ' on the FTech platform admin panel.']],
    button: { label: 'Set my password', url },
    notes: [
      `This link works once and expires in ${ADMIN_INVITE_DAYS} days.`,
      'After you set a password you will set up two-step sign-in with an authenticator app.',
      'Not expecting this? Ignore this email — nothing happens without the link.',
    ],
    footer: 'Sent because an FTech super admin invited this email address.',
    websiteUrl,
  });
}

/** Serialises admin user changes, so "the last super admin" checks cannot race. */
const lockAdmins = (tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('platform-admins'))`);

async function audit(tx: Tx, adminUserId: number, action: AdminAction, reason: string, details: Record<string, string | number | boolean | null>) {
  await tx.insert(adminAuditLog).values({ adminUserId, businessId: null, action, reason, details });
}

/** I10 list: active and invited admins (removed ones stay only in the audit log), active first. */
export async function listAdminUserRows(db: Db, now: Date = new Date()): Promise<AdminUserRow[]> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: platformAdmins.role,
      isActive: platformAdmins.isActive,
      twoFactorEnabled: users.twoFactorEnabled,
      hasPassword: sql<boolean>`exists(select 1 from ${accounts}
        where ${accounts.userId} = ${users.id} and ${accounts.providerId} = 'credential')`,
      lastSignInAt: sql<Date | null>`(select max(${adminAuditLog.createdAt}) from ${adminAuditLog}
        where ${adminAuditLog.adminUserId} = ${users.id} and ${adminAuditLog.action} = 'sign_in')`,
      inviteExpiresAt: sql<Date | null>`(select max(${verifications.expiresAt}) from ${verifications}
        where ${verifications.value} = ${users.id}::text and ${verifications.identifier} like ${`${INVITE_PREFIX}%`}
        and ${verifications.expiresAt} > ${now.toISOString()})`,
    })
    .from(platformAdmins)
    .innerJoin(users, eq(users.id, platformAdmins.userId))
    .where(eq(platformAdmins.isActive, true))
    .orderBy(desc(sql`exists(select 1 from ${accounts} where ${accounts.userId} = ${users.id})`), asc(users.name));
  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    email: r.email,
    role: toRole(r.role),
    status: r.hasPassword ? 'active' : 'invited',
    twoFactorEnabled: r.twoFactorEnabled,
    lastSignInAt: r.lastSignInAt ? new Date(r.lastSignInAt).toISOString() : null,
    inviteExpiresAt: r.hasPassword || !r.inviteExpiresAt ? null : new Date(r.inviteExpiresAt).toISOString(),
  }));
}

/** New one-time link for an invited admin (older links stop working). */
async function newInviteToken(tx: Tx, userId: number, now: Date): Promise<string> {
  await deleteInviteTokens(tx, userId);
  const token = randomBytes(24).toString('hex');
  await tx.insert(verifications).values({
    identifier: inviteKey(token),
    value: String(userId),
    expiresAt: new Date(now.getTime() + ADMIN_INVITE_DAYS * DAY_MS),
  });
  return token;
}

const deleteInviteTokens = (tx: Tx, userId: number) =>
  tx.delete(verifications).where(and(eq(verifications.value, String(userId)), like(verifications.identifier, `${INVITE_PREFIX}%`)));

/** Signs the person out everywhere (removed, or two-step reset). */
const revokeSessions = (tx: Tx, userId: number) => tx.delete(sessions).where(eq(sessions.userId, userId));

async function sendInvite(tx: Tx, mailer: Mailer, env: AdminUsersEnv, inviterId: number, to: string, role: AdminRole, token: string) {
  const [inviter] = await tx.select({ name: users.name }).from(users).where(eq(users.id, inviterId));
  const email = adminInviteEmail(inviter?.name ?? 'FTech', role, adminInviteUrl(env.WEBSITE_URL, token), env.WEBSITE_URL);
  // Inside the transaction: if the email cannot be sent, nothing is saved.
  await mailer.send({ to, ...email });
}

/**
 * Invite by work email. A new email gets a login without a password. A removed admin can be invited
 * again: their old password and two-step are cleared, so they start fresh from the link.
 * An email that already logs in to a business is refused — admins use a separate login.
 */
export async function inviteAdmin(
  db: Db,
  mailer: Mailer,
  env: AdminUsersEnv,
  inviterId: number,
  input: InviteAdminInput,
  now: Date = new Date(),
): Promise<AdminUserRow[]> {
  await db.transaction(async (tx) => {
    await lockAdmins(tx);
    const [existing] = await tx
      .select({ id: users.id, adminActive: platformAdmins.isActive, hasAdminRow: sql<boolean>`${platformAdmins.id} is not null` })
      .from(users)
      .leftJoin(platformAdmins, eq(platformAdmins.userId, users.id))
      .where(eq(users.email, input.email))
      .limit(1);

    let userId: number;
    if (existing) {
      if (existing.adminActive) throw new AppError(409, ADMIN_USER_ERRORS.alreadyAdmin, 'This email is already an admin');
      const [member] = await tx.select({ id: businessMembers.id }).from(businessMembers).where(eq(businessMembers.userId, existing.id)).limit(1);
      if (member || !existing.hasAdminRow) {
        throw new AppError(
          409,
          ADMIN_USER_ERRORS.emailInUse,
          'This email already logs in to OutletBooking. Use a separate work email for the admin panel',
        );
      }
      userId = existing.id;
      await tx.delete(accounts).where(eq(accounts.userId, userId));
      await tx.delete(twoFactors).where(eq(twoFactors.userId, userId));
      await tx.update(users).set({ twoFactorEnabled: false }).where(eq(users.id, userId));
      await revokeSessions(tx, userId);
      await tx
        .update(platformAdmins)
        .set({ role: input.role, isActive: true, invitedByUserId: inviterId })
        .where(eq(platformAdmins.userId, userId));
    } else {
      const [user] = await tx
        .insert(users)
        .values({ name: input.email.split('@')[0]!, email: input.email })
        .returning({ id: users.id });
      userId = user!.id;
      await tx.insert(platformAdmins).values({ userId, role: input.role, invitedByUserId: inviterId });
    }
    const token = await newInviteToken(tx, userId, now);
    await audit(tx, inviterId, 'add_admin', input.reason, { email: input.email, role: input.role, invitedAgain: !!existing });
    await sendInvite(tx, mailer, env, inviterId, input.email, input.role, token);
  });
  return listAdminUserRows(db, now);
}

/** Target admin row, locked; refuses changes to yourself (use I29 My account). */
async function targetAdmin(tx: Tx, actorId: number, userId: number) {
  if (userId === actorId) {
    throw new AppError(409, ADMIN_USER_ERRORS.notYourself, 'You can’t change your own admin access here');
  }
  const [row] = await tx
    .select({
      email: users.email,
      role: platformAdmins.role,
      hasPassword: sql<boolean>`exists(select 1 from ${accounts}
        where ${accounts.userId} = ${users.id} and ${accounts.providerId} = 'credential')`,
    })
    .from(platformAdmins)
    .innerJoin(users, eq(users.id, platformAdmins.userId))
    .where(and(eq(platformAdmins.userId, userId), eq(platformAdmins.isActive, true)))
    .limit(1);
  if (!row) throw notFound('Admin');
  return { ...row, role: toRole(row.role) };
}

/** Defence in depth: the actor is a super admin too, so today this only fails if data was changed by hand. */
async function ensureAnotherSuperAdmin(tx: Tx, userId: number) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(platformAdmins)
    .innerJoin(accounts, and(eq(accounts.userId, platformAdmins.userId), eq(accounts.providerId, 'credential')))
    .where(and(eq(platformAdmins.isActive, true), eq(platformAdmins.role, 'super_admin'), sql`${platformAdmins.userId} <> ${userId}`));
  if (!row?.n) {
    throw new AppError(409, ADMIN_USER_ERRORS.lastSuperAdmin, 'There must always be at least one super admin');
  }
}

export async function changeAdminRole(db: Db, actorId: number, userId: number, input: ChangeAdminRoleInput): Promise<AdminUserRow[]> {
  await db.transaction(async (tx) => {
    await lockAdmins(tx);
    const target = await targetAdmin(tx, actorId, userId);
    if (target.role === input.role) throw new AppError(409, 'no_change', 'This admin already has that role');
    if (target.role === 'super_admin') await ensureAnotherSuperAdmin(tx, userId);
    await tx.update(platformAdmins).set({ role: input.role }).where(eq(platformAdmins.userId, userId));
    await audit(tx, actorId, 'change_admin_role', input.reason, { email: target.email, from: target.role, to: input.role });
  });
  return listAdminUserRows(db);
}

/**
 * Lost phone: turns two-step off and signs them out everywhere. Their next sign-in shows the setup
 * QR code again (I6). Their password stays the same.
 */
export async function resetAdminTwoFactor(db: Db, actorId: number, userId: number, reason: string): Promise<AdminUserRow[]> {
  await db.transaction(async (tx) => {
    await lockAdmins(tx);
    const target = await targetAdmin(tx, actorId, userId);
    const [user] = await tx.select({ on: users.twoFactorEnabled }).from(users).where(eq(users.id, userId));
    if (!user?.on) throw new AppError(409, 'no_change', 'Two-step sign-in is not set up for this admin yet');
    await tx.delete(twoFactors).where(eq(twoFactors.userId, userId));
    await tx.update(users).set({ twoFactorEnabled: false }).where(eq(users.id, userId));
    await revokeSessions(tx, userId);
    await audit(tx, actorId, 'reset_two_factor', reason, { email: target.email });
  });
  return listAdminUserRows(db);
}

/** Removes access at once (signed out everywhere). Their audit entries stay. Also cancels an invite. */
export async function removeAdmin(db: Db, actorId: number, userId: number, reason: string): Promise<AdminUserRow[]> {
  await db.transaction(async (tx) => {
    await lockAdmins(tx);
    const target = await targetAdmin(tx, actorId, userId);
    if (target.role === 'super_admin' && target.hasPassword) await ensureAnotherSuperAdmin(tx, userId);
    await tx.update(platformAdmins).set({ isActive: false }).where(eq(platformAdmins.userId, userId));
    await deleteInviteTokens(tx, userId);
    await revokeSessions(tx, userId);
    await audit(tx, actorId, 'remove_admin', reason, { email: target.email, role: target.role, invite: !target.hasPassword });
  });
  return listAdminUserRows(db);
}

/** Sends a new invite link (the old one stops working). */
export async function resendAdminInvite(
  db: Db,
  mailer: Mailer,
  env: AdminUsersEnv,
  actorId: number,
  userId: number,
  reason: string,
  now: Date = new Date(),
): Promise<AdminUserRow[]> {
  await db.transaction(async (tx) => {
    await lockAdmins(tx);
    const target = await targetAdmin(tx, actorId, userId);
    if (target.hasPassword) throw new AppError(409, 'no_change', 'This admin has already accepted the invite');
    const token = await newInviteToken(tx, userId, now);
    await audit(tx, actorId, 'add_admin', reason, { email: target.email, role: target.role, resent: true });
    await sendInvite(tx, mailer, env, actorId, target.email, target.role, token);
  });
  return listAdminUserRows(db, now);
}

// ------------------------------------------------------------ invitee side (public, by token)

async function findInvite(q: Db | Tx, token: string, now: Date) {
  const [row] = await q
    .select({
      id: verifications.id,
      expiresAt: verifications.expiresAt,
      userId: users.id,
      email: users.email,
      role: platformAdmins.role,
      isActive: platformAdmins.isActive,
      invitedBy: sql<string | null>`(select u.name from ${users} u where u.id = ${platformAdmins.invitedByUserId})`,
      hasPassword: sql<boolean>`exists(select 1 from ${accounts}
        where ${accounts.userId} = ${users.id} and ${accounts.providerId} = 'credential')`,
    })
    .from(verifications)
    .innerJoin(users, sql`${users.id}::text = ${verifications.value}`)
    .innerJoin(platformAdmins, eq(platformAdmins.userId, users.id))
    .where(eq(verifications.identifier, inviteKey(token)))
    .limit(1);
  if (!row || !row.isActive || row.hasPassword) throw notFound('Invite');
  if (row.expiresAt <= now) {
    throw new AppError(410, ADMIN_USER_ERRORS.inviteExpired, 'This invite link has expired. Ask a super admin to send a new one');
  }
  return row;
}

export async function getAdminInvite(db: Db, token: string, now: Date = new Date()): Promise<AdminInviteInfo> {
  const row = await findInvite(db, token, now);
  return { email: row.email, role: toRole(row.role), invitedBy: row.invitedBy, expiresAt: row.expiresAt.toISOString() };
}

/**
 * Sets the new admin's name and password; the link then stops working. The email is confirmed by
 * opening the link. They sign in at /admin/login next and set up two-step.
 */
export async function acceptAdminInvite(
  db: Db,
  token: string,
  input: AcceptAdminInviteInput,
  now: Date = new Date(),
): Promise<{ email: string }> {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    await lockAdmins(tx);
    const invite = await findInvite(tx, token, now);
    await tx.update(users).set({ name: input.name, emailVerified: true }).where(eq(users.id, invite.userId));
    await tx.insert(accounts).values({
      userId: invite.userId,
      accountId: String(invite.userId),
      providerId: 'credential',
      password: passwordHash,
    });
    await deleteInviteTokens(tx, invite.userId);
    return { email: invite.email };
  });
}

