import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { businesses, businessMembers, subscriptions } from '@outletbooking/db';
import { hasPlanAccess, type MemberRole, type PlanFeature } from '@outletbooking/shared';
import { AppError, forbidden } from '../errors';
import { getGraceDays, getPlanFeatures } from '../services/plan-catalog';
import type { AppEnv } from '../types';

/** I2: refused while FTech has the business suspended for misuse. The app shows the reason from GET /me. */
export const suspendedError = (reason: string) =>
  new AppError(403, 'business_suspended', `This business has been suspended by OutletBooking: ${reason}`);

/**
 * Resolves the caller's business_id + role from business_members.
 * Must run after requireSession. Any business_id sent by the client is ignored.
 * (One business per user for now; owner membership wins if there are several.)
 * A suspended business is refused here, so every business route is locked (I2).
 */
export const resolveTenant = tenantMiddleware(false);

/** Same, but lets a suspended business through (GET /me shows why; log out / push token keep working). */
export const resolveTenantAllowSuspended = tenantMiddleware(true);

/** Staff of a business on a plan without the staff app (e.g. Starter). The app shows an explanation from GET /me. */
export const staffLockedError = () =>
  new AppError(403, 'staff_app_locked', 'The staff app is not included in this business’s plan. Ask the owner to upgrade.');

/**
 * Refuse a suspended business, or a staff login locked by the plan, on a route mounted with
 * resolveTenantAllowSuspended.
 */
export const rejectSuspended = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.tenant.suspendReason !== null) throw suspendedError(c.var.tenant.suspendReason);
  if (c.var.tenant.staffLocked) throw staffLockedError();
  await next();
});

/**
 * The plan must include this feature (I12 flags; the free trial has all). Run after resolveTenant.
 * `reports` also covers Customer history, `staff_app` the staff list, invites and roles & permissions.
 */
export const requirePlanFeature = (feature: PlanFeature) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!(await getPlanFeatures(c.var.db, c.var.tenant.plan))[feature]) {
      throw new AppError(403, 'plan_feature', 'This is not included in your plan. Upgrade to Business to use it.', { feature });
    }
    await next();
  });

function tenantMiddleware(allowSuspended: boolean) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const [member] = await c.var.db
      .select({
        memberId: businessMembers.id,
        businessId: businessMembers.businessId,
        role: businessMembers.role,
        canViewAll: businessMembers.canViewAll,
        canTakePayments: businessMembers.canTakePayments,
        canEditSetup: businessMembers.canEditSetup,
        suspendReason: businesses.suspendReason,
        sub: {
          plan: subscriptions.plan,
          status: subscriptions.status,
          trialEndsAt: subscriptions.trialEndsAt,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
        },
      })
      .from(businessMembers)
      .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
      .leftJoin(subscriptions, eq(subscriptions.businessId, businessMembers.businessId))
      .where(
        and(eq(businessMembers.userId, c.var.userId), eq(businessMembers.isActive, true), isNull(businesses.deletedAt)),
      )
      .orderBy(sql`${businessMembers.role} = 'owner' desc`, asc(businessMembers.id))
      .limit(1);

    if (!member) throw new AppError(403, 'no_business', 'Your account is not linked to an active business');
    if (member.suspendReason !== null && !allowSuspended) throw suspendedError(member.suspendReason);

    const isOwner = member.role === 'owner';
    const plan = member.sub?.plan ?? 'trial';
    // A staff login only works while the plan includes the staff app; the rows stay for when it does again.
    const staffLocked = !isOwner && !(await getPlanFeatures(c.var.db, plan)).staff_app;
    if (staffLocked && !allowSuspended) throw staffLockedError();
    c.set('tenant', {
      businessId: member.businessId,
      memberId: member.memberId,
      role: member.role as MemberRole,
      canViewAll: isOwner || member.canViewAll,
      canTakePayments: isOwner || member.canTakePayments,
      canEditSetup: isOwner || member.canEditSetup,
      planActive: hasPlanAccess(member.sub, new Date(), await getGraceDays(c.var.db)),
      suspendReason: member.suspendReason,
      plan,
      staffLocked,
    });
    await next();
  });
}

export type Permission = 'canTakePayments' | 'canEditSetup';

/** Owner, or staff granted this permission on D12 (run after resolveTenant). */
export const requirePermission = (permission: Permission) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!c.var.tenant[permission]) throw forbidden();
    await next();
  });

/** Restrict a route to the given roles (run after resolveTenant). */
export const requireRole = (...roles: MemberRole[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!roles.includes(c.var.tenant.role)) throw forbidden();
    await next();
  });

/**
 * FR-16.3: once the trial has ended without a paid plan the app is view only — every change is refused.
 * Mounted on the business data routes; account routes (log out, push token, delete account) stay open.
 */
export const requireActivePlan = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !c.var.tenant.planActive) {
    throw new AppError(403, 'plan_inactive', 'Your free trial has ended. Choose a plan to make changes.');
  }
  await next();
});
