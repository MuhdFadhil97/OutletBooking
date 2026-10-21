import { and, asc, eq, gt, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import {
  accounts,
  businesses,
  businessMembers,
  resources,
  staffInvitations,
  users,
  type Db,
  type Tx,
} from '@outletbooking/db';
import type {
  AcceptInviteNewAccount,
  InvitationInfo,
  MemberUpdate,
  StaffInvite,
  StaffInvitation,
  StaffListResponse,
  StaffMember,
} from '@outletbooking/shared';
import { LEGAL_VERSION } from '@outletbooking/shared';
import { AppError, forbidden, notFound, pgErrorInfo } from '../errors';
import { staffAbilities, staffInviteEmail } from './billing-emails';
import type { Mailer } from './mailer';
import { assertResourcesInBusiness } from './ownership';
import { getBusinessPlanFeatures } from './plan-catalog';

const inviteUrl = (appPublicUrl: string, token: string) => `${appPublicUrl.replace(/\/+$/, '')}/invite/${token}`;

// ------------------------------------------------------------ owner side

export async function listStaff(db: Db, businessId: number, appPublicUrl: string): Promise<StaffListResponse> {
  const [members, linked, invites] = await Promise.all([
    db
      .select({
        memberId: businessMembers.id,
        userId: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        role: businessMembers.role,
        isActive: businessMembers.isActive,
        canViewAll: businessMembers.canViewAll,
        canTakePayments: businessMembers.canTakePayments,
        canEditSetup: businessMembers.canEditSetup,
      })
      .from(businessMembers)
      .innerJoin(users, eq(users.id, businessMembers.userId))
      .where(eq(businessMembers.businessId, businessId))
      .orderBy(sql`${businessMembers.role} = 'owner' desc`, asc(users.name)),
    db
      .select({ id: resources.id, name: resources.name, userId: resources.userId })
      .from(resources)
      .where(and(eq(resources.businessId, businessId), isNull(resources.deletedAt)))
      .orderBy(asc(resources.sortOrder), asc(resources.id)),
    db
      .select({
        id: staffInvitations.id,
        email: staffInvitations.email,
        resourceId: staffInvitations.resourceId,
        canViewAll: staffInvitations.canViewAll,
        canTakePayments: staffInvitations.canTakePayments,
        canEditSetup: staffInvitations.canEditSetup,
        expiresAt: staffInvitations.expiresAt,
        token: staffInvitations.token,
      })
      .from(staffInvitations)
      .where(
        and(
          eq(staffInvitations.businessId, businessId),
          isNull(staffInvitations.acceptedAt),
          gt(staffInvitations.expiresAt, sql`now()`),
        ),
      )
      .orderBy(asc(staffInvitations.createdAt)),
  ]);

  return {
    members: members.map(
      (m): StaffMember => ({
        ...m,
        role: m.role as StaffMember['role'],
        resources: linked.filter((r) => r.userId === m.userId).map(({ id, name }) => ({ id, name })),
      }),
    ),
    invitations: invites.map(
      ({ token, expiresAt, ...i }): StaffInvitation => ({
        ...i,
        expiresAt: expiresAt.toISOString(),
        inviteUrl: inviteUrl(appPublicUrl, token),
      }),
    ),
  };
}

/** The 7-day invitation window, in words for the email (staff_invitations.expires_at defaults to now + 7 days). */
const INVITE_DAYS_TEXT = '7 days';

/**
 * Creates (or re-issues) an invitation. A previous pending invite for the same email is replaced.
 * With `mail`, the invite is also emailed (M3). The invite is saved first and an email that cannot be sent never fails it:
 * the owner still has the link to share, and `emailed` says which happened.
 */
export async function inviteStaff(
  db: Db,
  businessId: number,
  invitedBy: number,
  input: StaffInvite,
  appPublicUrl: string,
  mail?: { mailer: Mailer; websiteUrl: string },
): Promise<StaffInvitation> {
  const invitation = await db.transaction(async (tx) => {
    if (input.resourceId) await assertResourcesInBusiness(tx, businessId, [input.resourceId]);

    const [existing] = await tx
      .select({ id: businessMembers.id, isActive: businessMembers.isActive })
      .from(businessMembers)
      .innerJoin(users, eq(users.id, businessMembers.userId))
      .where(and(eq(businessMembers.businessId, businessId), eq(users.email, input.email)))
      .limit(1);
    if (existing?.isActive) {
      throw new AppError(409, 'already_member', 'This person is already on your team');
    }

    await tx
      .delete(staffInvitations)
      .where(
        and(
          eq(staffInvitations.businessId, businessId),
          eq(staffInvitations.email, input.email),
          isNull(staffInvitations.acceptedAt),
        ),
      );
    const [row] = await tx
      .insert(staffInvitations)
      .values({
        businessId,
        email: input.email,
        resourceId: input.resourceId,
        canViewAll: input.canViewAll,
        canTakePayments: input.canTakePayments,
        canEditSetup: input.canEditSetup,
        invitedBy,
      })
      .returning({
        id: staffInvitations.id,
        email: staffInvitations.email,
        resourceId: staffInvitations.resourceId,
        canViewAll: staffInvitations.canViewAll,
        canTakePayments: staffInvitations.canTakePayments,
        canEditSetup: staffInvitations.canEditSetup,
        expiresAt: staffInvitations.expiresAt,
        token: staffInvitations.token,
      });
    const { token, expiresAt, ...rest } = row!;
    return { ...rest, expiresAt: expiresAt.toISOString(), inviteUrl: inviteUrl(appPublicUrl, token) };
  });
  if (!mail) return invitation;

  let emailed = false;
  try {
    const [[biz], [inviter], [resource]] = await Promise.all([
      db.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, businessId)),
      db.select({ name: users.name }).from(users).where(eq(users.id, invitedBy)),
      input.resourceId
        ? db.select({ name: resources.name }).from(resources).where(and(eq(resources.businessId, businessId), eq(resources.id, input.resourceId)))
        : Promise.resolve([]),
    ]);
    const base = mail.websiteUrl.replace(/\/+$/, '');
    const email = staffInviteEmail({
      businessName: biz?.name ?? 'your business',
      inviterName: inviter?.name ?? 'The owner',
      abilities: staffAbilities(input),
      linkedTo: resource?.name ?? null,
      acceptUrl: invitation.inviteUrl,
      expiresIn: INVITE_DAYS_TEXT,
      websiteUrl: base,
    });
    await mail.mailer.send({ to: input.email, ...email, meta: { template: 'staff_invite', businessId } });
    emailed = true;
  } catch (err) {
    // Never log the address or the link (it signs someone in as staff).
    console.error('[staff] invite email failed for business', businessId, err instanceof Error ? err.message : err);
  }
  return { ...invitation, emailed };
}

export async function revokeInvitation(db: Db, businessId: number, id: number): Promise<void> {
  const rows = await db
    .delete(staffInvitations)
    .where(
      and(eq(staffInvitations.businessId, businessId), eq(staffInvitations.id, id), isNull(staffInvitations.acceptedAt)),
    )
    .returning({ id: staffInvitations.id });
  if (!rows.length) throw notFound('Invitation');
}

/** Owner changes a staff member's access. The owner's own membership cannot be changed here. */
export async function updateMember(
  db: Db,
  businessId: number,
  memberId: number,
  input: MemberUpdate,
  appPublicUrl: string,
): Promise<StaffMember> {
  await db.transaction(async (tx) => {
    const [member] = await tx
      .select({ userId: businessMembers.userId, role: businessMembers.role })
      .from(businessMembers)
      .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.id, memberId)))
      .for('update');
    if (!member) throw notFound('Staff member');
    const removesAccess = [input.isActive, input.canViewAll, input.canTakePayments, input.canEditSetup].includes(false);
    if (member.role === 'owner' && removesAccess) {
      throw forbidden("The owner's access cannot be removed");
    }

    const { resourceIds, ...flags } = input;
    if (Object.keys(flags).length) {
      await tx
        .update(businessMembers)
        .set(flags)
        .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.id, memberId)));
    }
    if (resourceIds) await linkResources(tx, businessId, member.userId, resourceIds);
  });
  const { members } = await listStaff(db, businessId, appPublicUrl);
  return members.find((m) => m.memberId === memberId)!;
}

/** Makes `resourceIds` exactly the resources linked to this user within the business. */
async function linkResources(tx: Tx, businessId: number, userId: number, resourceIds: number[]) {
  await assertResourcesInBusiness(tx, businessId, resourceIds);
  await tx
    .update(resources)
    .set({ userId: null })
    .where(
      and(
        eq(resources.businessId, businessId),
        eq(resources.userId, userId),
        resourceIds.length ? notInArray(resources.id, resourceIds) : undefined,
      ),
    );
  if (resourceIds.length) {
    await tx
      .update(resources)
      .set({ userId })
      .where(and(eq(resources.businessId, businessId), inArray(resources.id, resourceIds)));
  }
}

// ------------------------------------------------------------ invitee side (public, by token)

async function findInvitation(q: Db | Tx, token: string, lock = false) {
  const query = q
    .select({
      id: staffInvitations.id,
      businessId: staffInvitations.businessId,
      email: staffInvitations.email,
      resourceId: staffInvitations.resourceId,
      canViewAll: staffInvitations.canViewAll,
      canTakePayments: staffInvitations.canTakePayments,
      canEditSetup: staffInvitations.canEditSetup,
      expiresAt: staffInvitations.expiresAt,
      acceptedAt: staffInvitations.acceptedAt,
      businessName: businesses.name,
    })
    .from(staffInvitations)
    .innerJoin(businesses, and(eq(businesses.id, staffInvitations.businessId), isNull(businesses.deletedAt)))
    .where(eq(staffInvitations.token, token))
    .limit(1);
  const [row] = lock ? await query.for('update', { of: staffInvitations }) : await query;
  return row;
}

export async function getInvitation(db: Db, token: string, now = new Date()): Promise<InvitationInfo> {
  const inv = await findInvitation(db, token);
  if (!inv) throw notFound('Invitation');
  const [resource] = inv.resourceId
    ? await db
        .select({ name: resources.name })
        .from(resources)
        .where(and(eq(resources.businessId, inv.businessId), eq(resources.id, inv.resourceId), isNull(resources.deletedAt)))
    : [];
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, inv.email)).limit(1);
  return {
    businessName: inv.businessName,
    email: inv.email,
    resourceName: resource?.name ?? null,
    status: inv.acceptedAt ? 'accepted' : inv.expiresAt <= now ? 'expired' : 'pending',
    accountExists: !!user,
  };
}

/**
 * Accepts an invitation in one transaction:
 *  - new email → creates the login (body has name/phone/password);
 *  - existing email → the caller must be logged in as that email (sessionUserId).
 * Then adds/reactivates the staff membership and links the invited resource.
 */
export async function acceptInvitation(
  db: Db,
  token: string,
  opts: { sessionUserId?: number; newAccount?: AcceptInviteNewAccount },
  now = new Date(),
): Promise<{ email: string; businessName: string; businessId: number; userId: number }> {
  const passwordHash = opts.newAccount ? await hashPassword(opts.newAccount.password) : null;
  try {
    return await db.transaction(async (tx) => {
      const inv = await findInvitation(tx, token, true);
      if (!inv) throw notFound('Invitation');
      if (inv.acceptedAt) throw new AppError(410, 'invitation_used', 'This invitation has already been used');
      if (inv.expiresAt <= now) throw new AppError(410, 'invitation_expired', 'This invitation has expired. Ask the owner for a new one');

      if (!(await getBusinessPlanFeatures(tx, inv.businessId)).staff_app) {
        throw new AppError(403, 'plan_feature', 'This business’s plan does not include the staff app. Ask the owner to upgrade.', {
          feature: 'staff_app',
        });
      }

      const [existingUser] = await tx.select({ id: users.id }).from(users).where(eq(users.email, inv.email)).limit(1);
      let userId: number;
      if (existingUser) {
        if (opts.sessionUserId !== existingUser.id) {
          throw new AppError(401, 'login_required', `Log in as ${inv.email} to accept this invitation`);
        }
        userId = existingUser.id;
      } else {
        if (!opts.newAccount || !passwordHash) {
          throw new AppError(400, 'account_required', 'Enter your name, phone and a password to join');
        }
        const [user] = await tx
          .insert(users)
          .values({
            name: opts.newAccount.name,
            email: inv.email,
            phone: opts.newAccount.phone,
            termsAcceptedAt: now,
            termsVersion: LEGAL_VERSION,
          })
          .returning({ id: users.id });
        userId = user!.id;
        await tx
          .insert(accounts)
          .values({ userId, accountId: String(userId), providerId: 'credential', password: passwordHash });
      }

      const access = {
        canViewAll: inv.canViewAll,
        canTakePayments: inv.canTakePayments,
        canEditSetup: inv.canEditSetup,
      };
      await tx
        .insert(businessMembers)
        .values({ businessId: inv.businessId, userId, role: 'staff', ...access })
        .onConflictDoUpdate({
          target: [businessMembers.businessId, businessMembers.userId],
          // A returning staff member gets the access chosen on the new invitation.
          set: { isActive: true, ...access },
          // Never downgrade an owner who happens to accept a staff invite to their own business.
          setWhere: ne(businessMembers.role, 'owner'),
        });

      if (inv.resourceId) {
        await tx
          .update(resources)
          .set({ userId })
          .where(
            and(eq(resources.businessId, inv.businessId), eq(resources.id, inv.resourceId), isNull(resources.deletedAt)),
          );
      }

      await tx.update(staffInvitations).set({ acceptedAt: now }).where(eq(staffInvitations.id, inv.id));
      return { email: inv.email, businessName: inv.businessName, businessId: inv.businessId, userId };
    });
  } catch (err) {
    const { code, constraint } = pgErrorInfo(err);
    if (code === '23505' && constraint === 'users_email_unique') {
      throw new AppError(409, 'login_required', 'An account with this email already exists. Log in to accept');
    }
    throw err;
  }
}
