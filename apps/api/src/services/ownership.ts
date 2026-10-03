import { and, eq, inArray, isNull } from 'drizzle-orm';
import { businessMembers, resources, services, type Db, type Tx } from '@outletbooking/db';
import { AppError, notFound } from '../errors';

type Q = Db | Tx;

/**
 * Ids sent by the client must belong to the caller's business. Anything else is
 * reported as "not found" so we never leak whether another tenant's row exists.
 */
async function assertAll(found: number[], wanted: number[], what: string) {
  const set = new Set(found);
  if (wanted.some((id) => !set.has(id))) throw notFound(what);
}

export async function assertResourcesInBusiness(q: Q, businessId: number, ids: number[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const rows = await q
    .select({ id: resources.id })
    .from(resources)
    .where(and(eq(resources.businessId, businessId), inArray(resources.id, unique), isNull(resources.deletedAt)));
  await assertAll(
    rows.map((r) => r.id),
    unique,
    'Resource',
  );
}

export async function assertServicesInBusiness(q: Q, businessId: number, ids: number[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const rows = await q
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.businessId, businessId), inArray(services.id, unique), isNull(services.deletedAt)));
  await assertAll(
    rows.map((r) => r.id),
    unique,
    'Service',
  );
}

/** A resource can only be linked to a user who is an active member of the same business. */
export async function assertMemberUser(q: Q, businessId: number, userId: number) {
  const [row] = await q
    .select({ id: businessMembers.id })
    .from(businessMembers)
    .where(
      and(
        eq(businessMembers.businessId, businessId),
        eq(businessMembers.userId, userId),
        eq(businessMembers.isActive, true),
      ),
    )
    .limit(1);
  if (!row) throw new AppError(404, 'not_found', 'Staff member not found');
}

/** Postgres `time` → "HH:MM" */
export const hhmm = (t: string) => t.slice(0, 5);
