import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { businesses, businessMembers, subscriptions } from '@outletbooking/db';
import { hasPlanAccess, type MemberRole } from '@outletbooking/shared';
import { AppError, forbidden } from '../errors';
import type { AppEnv } from '../types';

/**
 * Resolves the caller's business_id + role from business_members.
 * Must run after requireSession. Any business_id sent by the client is ignored.
 * (One business per user for now; owner membership wins if there are several.)
 */
export const resolveTenant = createMiddleware<AppEnv>(async (c, next) => {
  const [member] = await c.var.db
    .select({
      memberId: businessMembers.id,
      businessId: businessMembers.businessId,
      role: businessMembers.role,
      canViewAll: businessMembers.canViewAll,
      canTakePayments: businessMembers.canTakePayments,
      canEditSetup: businessMembers.canEditSetup,
      sub: {
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

  const isOwner = member.role === 'owner';
  c.set('tenant', {
    businessId: member.businessId,
    memberId: member.memberId,
    role: member.role as MemberRole,
    canViewAll: isOwner || member.canViewAll,
    canTakePayments: isOwner || member.canTakePayments,
    canEditSetup: isOwner || member.canEditSetup,
    planActive: hasPlanAccess(member.sub),
  });
  await next();
});

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
