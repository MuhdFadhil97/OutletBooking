import { and, asc, eq, gt, isNull, lt, or, type SQL } from 'drizzle-orm';
import { timeOff, type Db } from '@outletbooking/db';
import type { TimeOff, TimeOffCreate, TimeOffUpdate } from '@outletbooking/shared';
import { AppError, notFound } from '../errors';
import { assertResourcesInBusiness } from './ownership';

const columns = {
  id: timeOff.id,
  resourceId: timeOff.resourceId,
  startAt: timeOff.startAt,
  endAt: timeOff.endAt,
  reason: timeOff.reason,
};

const toDto = (r: { id: number; resourceId: number | null; startAt: Date; endAt: Date; reason: string | null }): TimeOff => ({
  ...r,
  startAt: r.startAt.toISOString(),
  endAt: r.endAt.toISOString(),
});

interface ListFilter {
  from?: Date;
  to?: Date;
  /** Includes whole-business closures too, since they also block this resource. */
  resourceId?: number;
}

export async function listTimeOff(db: Db, businessId: number, f: ListFilter = {}): Promise<TimeOff[]> {
  const where: SQL[] = [eq(timeOff.businessId, businessId)];
  // Overlap with [from, to)
  if (f.from) where.push(gt(timeOff.endAt, f.from));
  if (f.to) where.push(lt(timeOff.startAt, f.to));
  if (f.resourceId) where.push(or(eq(timeOff.resourceId, f.resourceId), isNull(timeOff.resourceId))!);
  const rows = await db
    .select(columns)
    .from(timeOff)
    .where(and(...where))
    .orderBy(asc(timeOff.startAt));
  return rows.map(toDto);
}

export async function createTimeOff(db: Db, businessId: number, input: TimeOffCreate): Promise<TimeOff> {
  if (input.resourceId) await assertResourcesInBusiness(db, businessId, [input.resourceId]);
  const [row] = await db
    .insert(timeOff)
    .values({ ...input, businessId })
    .returning(columns);
  if (!row) throw new Error('time_off insert returned no row');
  return toDto(row);
}

export async function updateTimeOff(db: Db, businessId: number, id: number, input: TimeOffUpdate): Promise<TimeOff> {
  if (input.resourceId) await assertResourcesInBusiness(db, businessId, [input.resourceId]);
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select(columns)
      .from(timeOff)
      .where(and(eq(timeOff.businessId, businessId), eq(timeOff.id, id)))
      .for('update');
    if (!current) throw notFound('Time off');
    const startAt = input.startAt ?? current.startAt;
    const endAt = input.endAt ?? current.endAt;
    if (endAt <= startAt) throw new AppError(400, 'validation_error', 'End must be after start');
    if (!Object.keys(input).length) return toDto(current);
    const [row] = await tx
      .update(timeOff)
      .set(input)
      .where(and(eq(timeOff.businessId, businessId), eq(timeOff.id, id)))
      .returning(columns);
    return toDto(row!);
  });
}

export async function deleteTimeOff(db: Db, businessId: number, id: number): Promise<void> {
  const rows = await db
    .delete(timeOff)
    .where(and(eq(timeOff.businessId, businessId), eq(timeOff.id, id)))
    .returning({ id: timeOff.id });
  if (!rows.length) throw notFound('Time off');
}
