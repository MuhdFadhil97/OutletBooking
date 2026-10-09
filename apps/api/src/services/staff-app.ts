import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import { bookingAttachments, bookings, businesses, resources, timeOff, users, workingHours, type Db } from '@outletbooking/db';
import {
  ATTACHMENT_CONTENT_TYPES,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENTS_PER_BOOKING,
  type AttachmentContentType,
  type Booking,
  type BookingAttachment,
  type BookingResultInput,
  type MySchedule,
  type MyScheduleQuery,
} from '@outletbooking/shared';
import { AppError, forbidden, notFound } from '../errors';
import { localDayRange } from './availability';
import { getBooking, listBookings, type BookingScope } from './bookings';
import { hhmm } from './ownership';
import { businessPrefix, type ObjectStorage } from './storage';

/**
 * G2 / S1: the member's own schedule — resources linked to their login, those resources' hours,
 * time off (incl. whole-business closures) and bookings. Always "mine", even with "view all".
 */
export async function getMySchedule(
  db: Db,
  businessId: number,
  userId: number,
  query: MyScheduleQuery,
  scope: BookingScope,
): Promise<MySchedule> {
  const [biz] = await db.select({ timezone: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId));
  if (!biz) throw notFound('Business');

  const mine = await db
    .select({ id: resources.id, name: resources.name })
    .from(resources)
    .where(and(eq(resources.businessId, businessId), eq(resources.userId, userId), isNull(resources.deletedAt)))
    .orderBy(asc(resources.sortOrder), asc(resources.id));
  const ids = mine.map((r) => r.id);
  const from = localDayRange(query.from, biz.timezone).start;
  const to = localDayRange(query.to, biz.timezone).start;

  const [hours, off, list] = await Promise.all([
    ids.length
      ? db
          .select({ weekday: workingHours.weekday, startTime: workingHours.startTime, endTime: workingHours.endTime })
          .from(workingHours)
          .where(and(eq(workingHours.businessId, businessId), inArray(workingHours.resourceId, ids)))
          .orderBy(asc(workingHours.weekday), asc(workingHours.startTime))
      : [],
    db
      .select({ resourceId: timeOff.resourceId, startAt: timeOff.startAt, endAt: timeOff.endAt, reason: timeOff.reason })
      .from(timeOff)
      .where(
        and(
          eq(timeOff.businessId, businessId),
          gt(timeOff.endAt, from),
          lt(timeOff.startAt, to),
          ids.length ? or(isNull(timeOff.resourceId), inArray(timeOff.resourceId, ids)) : isNull(timeOff.resourceId),
        ),
      )
      .orderBy(asc(timeOff.startAt)),
    ids.length
      ? listBookings(db, businessId, { ...query, includeInactive: false }, { ...scope, linkedUserId: userId })
      : Promise.resolve<Booking[]>([]),
  ]);

  // Two linked resources with the same hours → one row.
  const seen = new Set<string>();
  const uniqueHours = hours
    .map((h) => ({ weekday: h.weekday, startTime: hhmm(h.startTime), endTime: hhmm(h.endTime) }))
    .filter((h) => {
      const k = `${h.weekday}|${h.startTime}|${h.endTime}`;
      return seen.has(k) ? false : (seen.add(k), true);
    });

  return {
    timezone: biz.timezone,
    resources: mine,
    hours: uniqueHours,
    timeOff: off.map((t) => ({ ...t, startAt: t.startAt.toISOString(), endAt: t.endAt.toISOString() })),
    bookings: list,
  };
}

const NOTES_STATUSES = ['confirmed', 'checked_in', 'completed'];

/** S2: result notes. Anyone who can see the booking (staff: their own resources). */
export async function setResultNotes(
  db: Db,
  businessId: number,
  bookingId: number,
  input: BookingResultInput,
  scope: BookingScope,
): Promise<Booking> {
  const current = await getBooking(db, businessId, bookingId, scope);
  if (!NOTES_STATUSES.includes(current.status)) {
    throw new AppError(409, 'not_editable', 'Result notes can be added once the booking is confirmed');
  }
  await db
    .update(bookings)
    .set({ resultNotes: input.resultNotes })
    .where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId)));
  return getBooking(db, businessId, bookingId, scope);
}

// ───────────────────────────────────────────── S2 photos

const LINK_TTL_SEC = 15 * 60;
const EXT: Record<AttachmentContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

function requireStorage(storage: ObjectStorage | null): ObjectStorage {
  if (!storage) throw new AppError(503, 'storage_unavailable', 'Photo storage is not set up yet');
  return storage;
}

export async function listAttachments(
  db: Db,
  storage: ObjectStorage | null,
  businessId: number,
  bookingId: number,
  scope: BookingScope,
): Promise<BookingAttachment[]> {
  await getBooking(db, businessId, bookingId, scope);
  const rows = await db
    .select({
      id: bookingAttachments.id,
      fileKey: bookingAttachments.fileKey,
      contentType: bookingAttachments.contentType,
      caption: bookingAttachments.caption,
      createdAt: bookingAttachments.createdAt,
      uploaderId: users.id,
      uploaderName: users.name,
    })
    .from(bookingAttachments)
    .leftJoin(users, eq(users.id, bookingAttachments.uploadedByUserId))
    .where(and(eq(bookingAttachments.businessId, businessId), eq(bookingAttachments.bookingId, bookingId)))
    .orderBy(asc(bookingAttachments.createdAt), asc(bookingAttachments.id));
  if (!rows.length) return [];
  const store = requireStorage(storage);
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      contentType: r.contentType,
      caption: r.caption,
      url: await store.signedUrl(r.fileKey, LINK_TTL_SEC),
      uploadedBy: r.uploaderId !== null ? { id: r.uploaderId, name: r.uploaderName ?? '' } : null,
      createdAt: r.createdAt.toISOString(),
    })),
  );
}

export interface UploadedFile {
  bytes: Uint8Array;
  contentType: string;
}

export async function addAttachment(
  db: Db,
  storage: ObjectStorage | null,
  ctx: { businessId: number; bookingId: number; userId: number; scope: BookingScope },
  file: UploadedFile,
): Promise<BookingAttachment> {
  const store = requireStorage(storage);
  const booking = await getBooking(db, ctx.businessId, ctx.bookingId, ctx.scope);
  if (booking.status === 'cancelled' || booking.status === 'no_show') {
    throw new AppError(409, 'not_editable', 'Photos cannot be added to a cancelled booking');
  }
  const contentType = file.contentType.toLowerCase() as AttachmentContentType;
  if (!ATTACHMENT_CONTENT_TYPES.includes(contentType)) {
    throw new AppError(400, 'invalid_file_type', 'Only JPEG, PNG, WebP or HEIC photos can be added');
  }
  if (file.bytes.byteLength === 0 || file.bytes.byteLength > ATTACHMENT_MAX_BYTES) {
    throw new AppError(400, 'file_too_large', 'Photos must be smaller than 10 MB');
  }
  const [existing] = await db
    .select({ n: count() })
    .from(bookingAttachments)
    .where(and(eq(bookingAttachments.businessId, ctx.businessId), eq(bookingAttachments.bookingId, ctx.bookingId)));
  if ((existing?.n ?? 0) >= ATTACHMENTS_PER_BOOKING) {
    throw new AppError(409, 'too_many_files', `A booking can have up to ${ATTACHMENTS_PER_BOOKING} photos`);
  }

  const key = `${businessPrefix(ctx.businessId)}bookings/${ctx.bookingId}/${randomUUID()}.${EXT[contentType]}`;
  await store.put(key, file.bytes, contentType);
  const [row] = await db
    .insert(bookingAttachments)
    .values({
      businessId: ctx.businessId,
      bookingId: ctx.bookingId,
      fileKey: key,
      contentType,
      uploadedByUserId: ctx.userId,
    })
    .returning({ id: bookingAttachments.id, createdAt: bookingAttachments.createdAt });
  const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId));
  return {
    id: row!.id,
    contentType,
    caption: null,
    url: await store.signedUrl(key, LINK_TTL_SEC),
    uploadedBy: { id: ctx.userId, name: me?.name ?? '' },
    createdAt: row!.createdAt.toISOString(),
  };
}

/** Owners remove any photo; staff only the ones they added. */
export async function deleteAttachment(
  db: Db,
  storage: ObjectStorage | null,
  ctx: { businessId: number; bookingId: number; userId: number; isOwner: boolean; scope: BookingScope },
  attachmentId: number,
): Promise<void> {
  await getBooking(db, ctx.businessId, ctx.bookingId, ctx.scope);
  const [row] = await db
    .select({ fileKey: bookingAttachments.fileKey, uploadedByUserId: bookingAttachments.uploadedByUserId })
    .from(bookingAttachments)
    .where(
      and(
        eq(bookingAttachments.businessId, ctx.businessId),
        eq(bookingAttachments.bookingId, ctx.bookingId),
        eq(bookingAttachments.id, attachmentId),
      ),
    );
  if (!row) throw notFound('Photo');
  if (!ctx.isOwner && row.uploadedByUserId !== ctx.userId) throw forbidden();
  await db.delete(bookingAttachments).where(eq(bookingAttachments.id, attachmentId));
  await requireStorage(storage).remove(row.fileKey);
}
