import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { businesses, businessMembers } from '@outletbooking/db';
import type { MemberRole } from '@outletbooking/shared';
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
    })
    .from(businessMembers)
    .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
    .where(
      and(eq(businessMembers.userId, c.var.userId), eq(businessMembers.isActive, true), isNull(businesses.deletedAt)),
    )
    .orderBy(sql`${businessMembers.role} = 'owner' desc`, asc(businessMembers.id))
    .limit(1);

  if (!member) throw new AppError(403, 'no_business', 'Your account is not linked to an active business');

  c.set('tenant', {
    businessId: member.businessId,
    memberId: member.memberId,
    role: member.role as MemberRole,
    canViewAll: member.role === 'owner' || member.canViewAll,
  });
  await next();
});

/** Restrict a route to the given roles (run after resolveTenant). */
export const requireRole = (...roles: MemberRole[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!roles.includes(c.var.tenant.role)) throw forbidden();
    await next();
  });
