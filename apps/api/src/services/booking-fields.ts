import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { bookingFields, type Db } from '@outletbooking/db';
import type { BookingField, BookingFieldCreate, BookingFieldType, BookingFieldUpdate } from '@outletbooking/shared';
import { AppError, notFound, pgErrorInfo } from '../errors';
import { assertServicesInBusiness } from './ownership';

const columns = {
  id: bookingFields.id,
  serviceId: bookingFields.serviceId,
  fieldKey: bookingFields.fieldKey,
  label: bookingFields.label,
  fieldType: bookingFields.fieldType,
  options: bookingFields.options,
  isRequired: bookingFields.isRequired,
  isSearchable: bookingFields.isSearchable,
  sortOrder: bookingFields.sortOrder,
  isActive: bookingFields.isActive,
};

type Row = Omit<BookingField, 'fieldType'> & { fieldType: string };
const toDto = (r: Row): BookingField => ({ ...r, fieldType: r.fieldType as BookingFieldType });

function mapUniqueViolation(err: unknown): never {
  const { code, constraint } = pgErrorInfo(err);
  if (code === '23505' && constraint === 'booking_fields_key_uidx') {
    throw new AppError(409, 'field_key_taken', 'A field with this key already exists');
  }
  throw err;
}

export async function listBookingFields(db: Db, businessId: number): Promise<BookingField[]> {
  const rows = await db
    .select(columns)
    .from(bookingFields)
    .where(eq(bookingFields.businessId, businessId))
    .orderBy(asc(bookingFields.sortOrder), asc(bookingFields.id));
  return rows.map(toDto);
}

export async function createBookingField(db: Db, businessId: number, input: BookingFieldCreate): Promise<BookingField> {
  if (input.serviceId) await assertServicesInBusiness(db, businessId, [input.serviceId]);
  try {
    const [row] = await db
      .insert(bookingFields)
      .values({ ...input, businessId })
      .returning(columns);
    return toDto(row!);
  } catch (err) {
    mapUniqueViolation(err);
  }
}

export async function updateBookingField(
  db: Db,
  businessId: number,
  id: number,
  input: BookingFieldUpdate,
): Promise<BookingField> {
  if (input.serviceId) await assertServicesInBusiness(db, businessId, [input.serviceId]);
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select(columns)
      .from(bookingFields)
      .where(and(eq(bookingFields.businessId, businessId), eq(bookingFields.id, id)))
      .for('update');
    if (!current) throw notFound('Booking field');

    const fieldType = input.fieldType ?? current.fieldType;
    const options = input.options !== undefined ? input.options : current.options;
    if (fieldType === 'select' && (!options || options.length < 2)) {
      throw new AppError(400, 'validation_error', 'A dropdown needs at least 2 options');
    }
    const values = { ...input, ...(fieldType !== 'select' ? { options: null } : {}) };
    if (!Object.keys(input).length) return toDto(current);
    try {
      const [row] = await tx
        .update(bookingFields)
        .set(values)
        .where(and(eq(bookingFields.businessId, businessId), eq(bookingFields.id, id)))
        .returning(columns);
      return toDto(row!);
    } catch (err) {
      mapUniqueViolation(err);
    }
  });
}

/**
 * Hard delete: answers already stored in bookings.custom_fields keep their key and value.
 * Use isActive=false to hide a field from the booking form but keep it in reports.
 */
export async function deleteBookingField(db: Db, businessId: number, id: number): Promise<void> {
  const rows = await db
    .delete(bookingFields)
    .where(and(eq(bookingFields.businessId, businessId), eq(bookingFields.id, id)))
    .returning({ id: bookingFields.id });
  if (!rows.length) throw notFound('Booking field');
}

/** Sets sort_order to the position in `ids`. Every id must belong to the business. */
export async function reorderBookingFields(db: Db, businessId: number, ids: number[]): Promise<BookingField[]> {
  const unique = [...new Set(ids)];
  await db.transaction(async (tx) => {
    const found = await tx
      .select({ id: bookingFields.id })
      .from(bookingFields)
      .where(and(eq(bookingFields.businessId, businessId), inArray(bookingFields.id, unique)));
    if (found.length !== unique.length) throw notFound('Booking field');
    const cases = sql.join(
      unique.map((id, i) => sql`when ${id} then ${i}::int`),
      sql` `,
    );
    await tx
      .update(bookingFields)
      .set({ sortOrder: sql`case ${bookingFields.id} ${cases} end` })
      .where(and(eq(bookingFields.businessId, businessId), inArray(bookingFields.id, unique)));
  });
  return listBookingFields(db, businessId);
}
