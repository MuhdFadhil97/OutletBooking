import { and, asc, desc, eq, ilike, inArray, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { bookings, customers, payments, refunds, type Db } from '@outletbooking/db';
import {
  customerTag,
  NEW_CUSTOMER_DAYS,
  REGULAR_MIN_VISITS,
  type Booking,
  type CustomerCreateInput,
  type CustomerList,
  type CustomerListQuery,
  type CustomerProfile,
  type CustomerSummary,
  type CustomerUpdateInput,
} from '@outletbooking/shared';
import { AppError, notFound, pgErrorInfo } from '../errors';
import { customerBookings } from './bookings';

/** D11 PDPA erase: the name every erased customer gets. */
export const ERASED_NAME = 'Deleted customer';

const ACTIVE = ['pending', 'confirmed', 'checked_in'];

/** A booking the customer came to (see packages/shared customers.ts). */
const isVisit = sql`(${bookings.status} in ('checked_in', 'completed') or (${bookings.status} = 'confirmed' and ${bookings.endAt} < now()))`;

const visits = sql<number>`count(${bookings.id}) filter (where ${isVisit})::int`;
const noShows = sql<number>`count(${bookings.id}) filter (where ${bookings.status} = 'no_show')::int`;
const lastVisit = sql<Date | null>`max(${bookings.startAt}) filter (where ${isVisit})`;

/** Treat % _ \ typed by the user as plain characters in LIKE patterns. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Name, or phone digits when the input looks like a phone number ("012-345 6789" → +60123456789). */
function searchCondition(term: string): SQL | undefined {
  const conds: SQL[] = [ilike(customers.name, `%${escapeLike(term)}%`)];
  const digits = term.replace(/\D/g, '').replace(/^0/, '');
  if (/^[\d\s+()-]+$/.test(term) && digits.length >= 3) conds.push(like(customers.phone, `%${digits}%`));
  return or(...conds);
}

function filterCondition(filter: CustomerListQuery['filter']): SQL | undefined {
  switch (filter) {
    case 'regulars':
      return sql`${visits} >= ${REGULAR_MIN_VISITS}`;
    case 'new':
      return sql`${visits} <= 1 and ${customers.createdAt} >= now() - make_interval(days => ${NEW_CUSTOMER_DAYS})`;
    case 'no_shows':
      return sql`${noShows} >= 1`;
    default:
      return undefined;
  }
}

const summaryColumns = {
  id: customers.id,
  name: customers.name,
  phone: customers.phone,
  email: customers.email,
  createdAt: customers.createdAt,
  visits,
  noShows,
  lastVisit,
};

function toSummary(r: {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  createdAt: Date;
  visits: number;
  noShows: number;
  lastVisit: Date | string | null;
}): CustomerSummary {
  const base = {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    visits: Number(r.visits),
    noShows: Number(r.noShows),
    // Aggregates over raw SQL come back as text from postgres-js.
    lastVisitAt: r.lastVisit ? new Date(r.lastVisit).toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
  return { ...base, tag: customerTag(base) };
}

/** Live customers of the business (erased and archived ones are left out). */
const liveCustomers = (businessId: number) =>
  and(eq(customers.businessId, businessId), isNull(customers.deletedAt), isNull(customers.anonymizedAt));

/** D10: search + Regulars / New / No-shows, most recent visit first. */
export async function listCustomers(db: Db, businessId: number, query: CustomerListQuery): Promise<CustomerList> {
  const rows = await db
    .select({ ...summaryColumns, total: sql<number>`count(*) over ()::int` })
    .from(customers)
    .leftJoin(bookings, and(eq(bookings.businessId, customers.businessId), eq(bookings.customerId, customers.id)))
    .where(and(liveCustomers(businessId), query.q ? searchCondition(query.q) : undefined))
    .groupBy(customers.id)
    .having(filterCondition(query.filter))
    .orderBy(sql`${lastVisit} desc nulls last`, desc(customers.createdAt), asc(customers.id))
    .limit(query.limit)
    .offset(query.offset);
  return { items: rows.map(toSummary), total: Number(rows[0]?.total ?? 0) };
}

async function summary(db: Db, businessId: number, id: number): Promise<CustomerSummary & { notes: string | null }> {
  const [row] = await db
    .select({ ...summaryColumns, notes: customers.notes })
    .from(customers)
    .leftJoin(bookings, and(eq(bookings.businessId, customers.businessId), eq(bookings.customerId, customers.id)))
    .where(and(liveCustomers(businessId), eq(customers.id, id)))
    .groupBy(customers.id);
  if (!row) throw notFound('Customer');
  return { ...toSummary(row), notes: row.notes };
}

/** D11: stats, notes, upcoming and past bookings. */
export async function getCustomer(db: Db, businessId: number, id: number, now = new Date()): Promise<CustomerProfile> {
  const base = await summary(db, businessId, id);
  const [all, [paid], [refunded]] = await Promise.all([
    customerBookings(db, businessId, id),
    db
      .select({ n: sql<number>`coalesce(sum(${payments.amountSen}), 0)::int` })
      .from(payments)
      .innerJoin(bookings, and(eq(bookings.businessId, payments.businessId), eq(bookings.id, payments.bookingId)))
      .where(and(eq(payments.businessId, businessId), eq(bookings.customerId, id), eq(payments.status, 'paid'))),
    db
      .select({ n: sql<number>`coalesce(sum(${refunds.amountSen}), 0)::int` })
      .from(refunds)
      .innerJoin(bookings, and(eq(bookings.businessId, refunds.businessId), eq(bookings.id, refunds.bookingId)))
      .where(and(eq(refunds.businessId, businessId), eq(bookings.customerId, id))),
  ]);
  const isUpcoming = (b: Booking) => ACTIVE.includes(b.status) && Date.parse(b.endAt) >= now.getTime();
  return {
    ...base,
    spentSen: Number(paid?.n ?? 0) - Number(refunded?.n ?? 0),
    upcoming: all.filter(isUpcoming).reverse(),
    history: all.filter((b) => !isUpcoming(b)).slice(0, 50),
  };
}

/** Same phone = same customer (BR-06): a second one is refused, pointing at the first. */
async function phoneOwner(db: Db, businessId: number, phone: string, exceptId?: number) {
  const [row] = await db
    .select({ id: customers.id, deletedAt: customers.deletedAt })
    .from(customers)
    .where(and(eq(customers.businessId, businessId), eq(customers.phone, phone)));
  return row && row.id !== exceptId ? row : null;
}

export async function createCustomer(db: Db, businessId: number, input: CustomerCreateInput): Promise<CustomerProfile> {
  const existing = await phoneOwner(db, businessId, input.phone);
  if (existing && !existing.deletedAt) {
    throw new AppError(409, 'customer_exists', 'A customer with this mobile number already exists', { id: existing.id });
  }
  let id: number;
  if (existing) {
    // Archived earlier: bring the same record back (keeps their history).
    await db
      .update(customers)
      .set({ name: input.name, email: input.email ?? null, notes: input.notes ?? null, deletedAt: null })
      .where(eq(customers.id, existing.id));
    id = existing.id;
  } else {
    const [row] = await db
      .insert(customers)
      .values({ businessId, name: input.name, phone: input.phone, email: input.email ?? null, notes: input.notes ?? null })
      .returning({ id: customers.id });
    id = row!.id;
  }
  return getCustomer(db, businessId, id);
}

export async function updateCustomer(db: Db, businessId: number, id: number, input: CustomerUpdateInput): Promise<CustomerProfile> {
  await summary(db, businessId, id); // 404 for other businesses / erased customers
  if (input.phone && (await phoneOwner(db, businessId, input.phone, id))) {
    throw new AppError(409, 'phone_taken', 'Another customer already has this mobile number');
  }
  try {
    await db
      .update(customers)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      })
      .where(and(eq(customers.businessId, businessId), eq(customers.id, id)));
  } catch (err) {
    if (pgErrorInfo(err).code === '23505') throw new AppError(409, 'phone_taken', 'Another customer already has this mobile number');
    throw err;
  }
  return getCustomer(db, businessId, id);
}

/**
 * D11 · PDPA erase on request: the customer becomes "Deleted customer" with no phone, email or notes,
 * and their personal details on bookings (address, booking answers, their notes) are cleared.
 * Bookings, payments and refunds stay for reports. Refused while they still have upcoming bookings.
 */
export async function eraseCustomer(db: Db, businessId: number, id: number, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const [c] = await tx
      .select({ anonymizedAt: customers.anonymizedAt })
      .from(customers)
      .where(and(eq(customers.businessId, businessId), eq(customers.id, id)))
      .for('update');
    if (!c || c.anonymizedAt) throw notFound('Customer');

    const [upcoming] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.businessId, businessId),
          eq(bookings.customerId, id),
          inArray(bookings.status, ACTIVE),
          sql`${bookings.endAt} >= ${now.toISOString()}::timestamptz`,
        ),
      )
      .limit(1);
    if (upcoming) {
      throw new AppError(409, 'has_upcoming_bookings', 'Cancel this customer’s upcoming bookings first, then delete their data');
    }

    await tx
      .update(customers)
      .set({ name: ERASED_NAME, phone: null, email: null, notes: null, anonymizedAt: now })
      .where(eq(customers.id, id));
    await tx
      .update(bookings)
      .set({ locationAddress: null, customFields: {}, customerNotes: null })
      .where(and(eq(bookings.businessId, businessId), eq(bookings.customerId, id)));
  });
}
