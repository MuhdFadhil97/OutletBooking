import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { resources, resourceServices, services, subscriptions, users, type Db, type Tx } from '@outletbooking/db';
import type { Resource, ResourceCreate, ResourceType, ResourceUpdate } from '@outletbooking/shared';
import { AppError, notFound } from '../errors';
import type { Tenant } from '../types';
import { assertMemberUser, assertServicesInBusiness } from './ownership';

type Q = Db | Tx;

interface ListOptions {
  onlyIds?: number[];
  /** Staff without "view all" only see resources linked to their own login. */
  linkedUserId?: number;
}

export async function listResources(q: Q, businessId: number, opts: ListOptions = {}): Promise<Resource[]> {
  const where = [eq(resources.businessId, businessId), isNull(resources.deletedAt)];
  if (opts.onlyIds) where.push(inArray(resources.id, opts.onlyIds.length ? opts.onlyIds : [0]));
  if (opts.linkedUserId !== undefined) where.push(eq(resources.userId, opts.linkedUserId));

  const rows = await q
    .select({
      id: resources.id,
      name: resources.name,
      resourceType: resources.resourceType,
      color: resources.color,
      sortOrder: resources.sortOrder,
      isActive: resources.isActive,
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
    })
    .from(resources)
    .leftJoin(users, eq(users.id, resources.userId))
    .where(and(...where))
    .orderBy(asc(resources.sortOrder), asc(resources.id));
  if (!rows.length) return [];

  const links = await q
    .select({ resourceId: resourceServices.resourceId, serviceId: resourceServices.serviceId })
    .from(resourceServices)
    .innerJoin(
      services,
      and(eq(services.businessId, resourceServices.businessId), eq(services.id, resourceServices.serviceId)),
    )
    .where(
      and(
        eq(resourceServices.businessId, businessId),
        inArray(
          resourceServices.resourceId,
          rows.map((r) => r.id),
        ),
        isNull(services.deletedAt),
      ),
    )
    .orderBy(asc(resourceServices.serviceId));

  return rows.map(({ userId, userName, userEmail, ...r }) => ({
    ...r,
    resourceType: r.resourceType as ResourceType,
    linkedUser: userId !== null ? { id: userId, name: userName ?? '', email: userEmail ?? '' } : null,
    serviceIds: links.filter((l) => l.resourceId === r.id).map((l) => l.serviceId),
  }));
}

/** Staff only see their linked resources unless the owner allowed "view all". */
export function resourceScope(tenant: Tenant, userId: number): ListOptions {
  return tenant.canViewAll ? {} : { linkedUserId: userId };
}

export async function getResource(q: Q, businessId: number, id: number, opts: ListOptions = {}): Promise<Resource> {
  const [row] = await listResources(q, businessId, { ...opts, onlyIds: [id] });
  if (!row) throw notFound('Resource');
  return row;
}

async function replaceServiceLinks(tx: Tx, businessId: number, resourceId: number, serviceIds?: number[]) {
  if (!serviceIds) return;
  await assertServicesInBusiness(tx, businessId, serviceIds);
  await tx
    .delete(resourceServices)
    .where(and(eq(resourceServices.businessId, businessId), eq(resourceServices.resourceId, resourceId)));
  const unique = [...new Set(serviceIds)];
  if (unique.length) {
    await tx.insert(resourceServices).values(unique.map((serviceId) => ({ businessId, resourceId, serviceId })));
  }
}

/** Plan limit on active (not archived) resources. */
async function assertUnderResourceLimit(tx: Tx, businessId: number) {
  // Serialise concurrent creates for this business so the count is reliable.
  const [sub] = await tx
    .select({ limit: subscriptions.resourceLimit })
    .from(subscriptions)
    .where(eq(subscriptions.businessId, businessId))
    .for('update');
  const [used] = await tx
    .select({ n: count() })
    .from(resources)
    .where(and(eq(resources.businessId, businessId), isNull(resources.deletedAt)));
  const limit = sub?.limit ?? 10;
  if ((used?.n ?? 0) >= limit) {
    throw new AppError(409, 'resource_limit', `Your plan allows up to ${limit} resources`);
  }
}

export async function createResource(db: Db, businessId: number, input: ResourceCreate): Promise<Resource> {
  const { serviceIds, ...values } = input;
  return db.transaction(async (tx) => {
    await assertUnderResourceLimit(tx, businessId);
    if (values.userId) await assertMemberUser(tx, businessId, values.userId);
    const [row] = await tx
      .insert(resources)
      .values({ ...values, businessId })
      .returning({ id: resources.id });
    if (!row) throw new Error('resource insert returned no row');
    await replaceServiceLinks(tx, businessId, row.id, serviceIds);
    return getResource(tx, businessId, row.id);
  });
}

export async function updateResource(db: Db, businessId: number, id: number, input: ResourceUpdate): Promise<Resource> {
  const { serviceIds, ...values } = input;
  return db.transaction(async (tx) => {
    if (values.userId) await assertMemberUser(tx, businessId, values.userId);
    if (Object.keys(values).length) {
      const rows = await tx
        .update(resources)
        .set(values)
        .where(and(eq(resources.businessId, businessId), eq(resources.id, id), isNull(resources.deletedAt)))
        .returning({ id: resources.id });
      if (!rows.length) throw notFound('Resource');
    } else {
      await getResource(tx, businessId, id);
    }
    await replaceServiceLinks(tx, businessId, id, serviceIds);
    return getResource(tx, businessId, id);
  });
}

/** Soft delete (archive). Frees a plan slot; past bookings keep their resource. */
export async function archiveResource(db: Db, businessId: number, id: number): Promise<void> {
  const rows = await db
    .update(resources)
    .set({ deletedAt: sql`now()`, isActive: false })
    .where(and(eq(resources.businessId, businessId), eq(resources.id, id), isNull(resources.deletedAt)))
    .returning({ id: resources.id });
  if (!rows.length) throw notFound('Resource');
}
