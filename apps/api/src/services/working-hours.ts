import { and, asc, eq, inArray } from 'drizzle-orm';
import { workingHours, type Db, type Tx } from '@outletbooking/db';
import type { WorkingHour, WorkingHourInput } from '@outletbooking/shared';
import { assertResourcesInBusiness, hhmm } from './ownership';

type Q = Db | Tx;

export async function getWorkingHours(q: Q, businessId: number, resourceId: number): Promise<WorkingHour[]> {
  await assertResourcesInBusiness(q, businessId, [resourceId]);
  const rows = await q
    .select({
      id: workingHours.id,
      weekday: workingHours.weekday,
      startTime: workingHours.startTime,
      endTime: workingHours.endTime,
    })
    .from(workingHours)
    .where(and(eq(workingHours.businessId, businessId), eq(workingHours.resourceId, resourceId)))
    .orderBy(asc(workingHours.weekday), asc(workingHours.startTime));
  return rows.map((r) => ({ ...r, startTime: hhmm(r.startTime), endTime: hhmm(r.endTime) }));
}

async function replace(tx: Tx, businessId: number, resourceIds: number[], hours: WorkingHourInput[]) {
  await tx
    .delete(workingHours)
    .where(and(eq(workingHours.businessId, businessId), inArray(workingHours.resourceId, resourceIds)));
  const values = resourceIds.flatMap((resourceId) => hours.map((h) => ({ ...h, businessId, resourceId })));
  if (values.length) await tx.insert(workingHours).values(values);
}

/** Replaces the resource's whole weekly schedule (overlaps already rejected by the zod schema). */
export async function setWorkingHours(
  db: Db,
  businessId: number,
  resourceId: number,
  hours: WorkingHourInput[],
): Promise<WorkingHour[]> {
  return db.transaction(async (tx) => {
    await assertResourcesInBusiness(tx, businessId, [resourceId]);
    await replace(tx, businessId, [resourceId], hours);
    return getWorkingHours(tx, businessId, resourceId);
  });
}

/** FR-04.4: copy one resource's weekly hours onto others (replacing theirs). */
export async function copyWorkingHours(
  db: Db,
  businessId: number,
  fromResourceId: number,
  toResourceIds: number[],
): Promise<void> {
  const targets = [...new Set(toResourceIds)].filter((id) => id !== fromResourceId);
  await db.transaction(async (tx) => {
    await assertResourcesInBusiness(tx, businessId, [fromResourceId, ...targets]);
    const source = await getWorkingHours(tx, businessId, fromResourceId);
    if (targets.length) {
      await replace(
        tx,
        businessId,
        targets,
        source.map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime })),
      );
    }
  });
}
