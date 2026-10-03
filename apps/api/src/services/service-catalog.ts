import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { resources, resourceServices, servicePriceRules, services, type Db, type Tx } from '@outletbooking/db';
import type { LocationType, PriceRule, PriceUnit, Service, ServiceCreate, ServiceUpdate } from '@outletbooking/shared';
import { AppError, notFound } from '../errors';
import { assertResourcesInBusiness, hhmm } from './ownership';

const columns = {
  id: services.id,
  name: services.name,
  description: services.description,
  durationMin: services.durationMin,
  durationOptions: services.durationOptions,
  priceUnit: services.priceUnit,
  priceSen: services.priceSen,
  depositSen: services.depositSen,
  prepayFull: services.prepayFull,
  bufferMin: services.bufferMin,
  travelBufferMin: services.travelBufferMin,
  locationType: services.locationType,
  isVisible: services.isVisible,
  sortOrder: services.sortOrder,
};

type Q = Db | Tx;

/** Services (not archived) with their peak rules and assigned resources. */
export async function listServices(q: Q, businessId: number, onlyIds?: number[]): Promise<Service[]> {
  const where = [eq(services.businessId, businessId), isNull(services.deletedAt)];
  if (onlyIds) where.push(inArray(services.id, onlyIds.length ? onlyIds : [0]));
  const rows = await q
    .select(columns)
    .from(services)
    .where(and(...where))
    .orderBy(asc(services.sortOrder), asc(services.id));
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  const [rules, links] = await Promise.all([
    q
      .select({
        id: servicePriceRules.id,
        serviceId: servicePriceRules.serviceId,
        name: servicePriceRules.name,
        weekday: servicePriceRules.weekday,
        startTime: servicePriceRules.startTime,
        endTime: servicePriceRules.endTime,
        priceSen: servicePriceRules.priceSen,
      })
      .from(servicePriceRules)
      .where(and(eq(servicePriceRules.businessId, businessId), inArray(servicePriceRules.serviceId, ids)))
      .orderBy(asc(servicePriceRules.weekday), asc(servicePriceRules.startTime)),
    q
      .select({ serviceId: resourceServices.serviceId, resourceId: resourceServices.resourceId })
      .from(resourceServices)
      .innerJoin(
        resources,
        and(eq(resources.businessId, resourceServices.businessId), eq(resources.id, resourceServices.resourceId)),
      )
      .where(
        and(
          eq(resourceServices.businessId, businessId),
          inArray(resourceServices.serviceId, ids),
          isNull(resources.deletedAt),
        ),
      )
      .orderBy(asc(resourceServices.resourceId)),
  ]);

  return rows.map((r) => ({
    ...r,
    priceUnit: r.priceUnit as PriceUnit,
    locationType: r.locationType as LocationType,
    priceRules: rules
      .filter((x) => x.serviceId === r.id)
      .map(({ serviceId: _s, ...x }): PriceRule => ({ ...x, startTime: hhmm(x.startTime), endTime: hhmm(x.endTime) })),
    resourceIds: links.filter((l) => l.serviceId === r.id).map((l) => l.resourceId),
  }));
}

export async function getService(q: Q, businessId: number, id: number): Promise<Service> {
  const [row] = await listServices(q, businessId, [id]);
  if (!row) throw notFound('Service');
  return row;
}

async function replacePriceRules(tx: Tx, businessId: number, serviceId: number, rules: ServiceCreate['priceRules']) {
  if (!rules) return;
  await tx
    .delete(servicePriceRules)
    .where(and(eq(servicePriceRules.businessId, businessId), eq(servicePriceRules.serviceId, serviceId)));
  if (rules.length) {
    await tx.insert(servicePriceRules).values(rules.map((r) => ({ ...r, businessId, serviceId })));
  }
}

async function replaceResourceLinks(tx: Tx, businessId: number, serviceId: number, resourceIds?: number[]) {
  if (!resourceIds) return;
  await assertResourcesInBusiness(tx, businessId, resourceIds);
  await tx
    .delete(resourceServices)
    .where(and(eq(resourceServices.businessId, businessId), eq(resourceServices.serviceId, serviceId)));
  const unique = [...new Set(resourceIds)];
  if (unique.length) {
    await tx.insert(resourceServices).values(unique.map((resourceId) => ({ businessId, serviceId, resourceId })));
  }
}

export async function createService(db: Db, businessId: number, input: ServiceCreate): Promise<Service> {
  const { priceRules, resourceIds, ...values } = input;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(services)
      .values({ ...values, businessId })
      .returning({ id: services.id });
    if (!row) throw new Error('service insert returned no row');
    await replacePriceRules(tx, businessId, row.id, priceRules);
    await replaceResourceLinks(tx, businessId, row.id, resourceIds);
    return getService(tx, businessId, row.id);
  });
}

export async function updateService(db: Db, businessId: number, id: number, input: ServiceUpdate): Promise<Service> {
  const { priceRules, resourceIds, ...values } = input;
  return db.transaction(async (tx) => {
    // Lock the row and validate the merged result (e.g. new durationMin vs existing options).
    const [current] = await tx
      .select({
        durationMin: services.durationMin,
        durationOptions: services.durationOptions,
        priceUnit: services.priceUnit,
        priceSen: services.priceSen,
        depositSen: services.depositSen,
      })
      .from(services)
      .where(and(eq(services.businessId, businessId), eq(services.id, id), isNull(services.deletedAt)))
      .for('update');
    if (!current) throw notFound('Service');

    const merged = { ...current, ...values };
    if (merged.durationOptions?.some((o) => o % merged.durationMin !== 0)) {
      throw new AppError(400, 'validation_error', 'Each duration option must be a multiple of the base duration');
    }
    if (merged.priceUnit !== 'per_block' && merged.depositSen > merged.priceSen) {
      throw new AppError(400, 'validation_error', 'Deposit cannot be more than the price');
    }

    if (Object.keys(values).length) {
      await tx
        .update(services)
        .set(values)
        .where(and(eq(services.businessId, businessId), eq(services.id, id)));
    }
    await replacePriceRules(tx, businessId, id, priceRules);
    await replaceResourceLinks(tx, businessId, id, resourceIds);
    return getService(tx, businessId, id);
  });
}

/** Soft delete (archive). Past bookings keep pointing at it. */
export async function archiveService(db: Db, businessId: number, id: number): Promise<void> {
  const rows = await db
    .update(services)
    .set({ deletedAt: sql`now()`, isVisible: false })
    .where(and(eq(services.businessId, businessId), eq(services.id, id), isNull(services.deletedAt)))
    .returning({ id: services.id });
  if (!rows.length) throw notFound('Service');
}
