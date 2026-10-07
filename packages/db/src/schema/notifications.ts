import { check, foreignKey, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { NOTIFICATION_TYPES, type NotificationType } from '@outletbooking/shared';
import { createdAt, idPk, updatedAt } from './columns';
import { users } from './auth';
import { businesses } from './tenant';
import { bookings } from './bookings';

/** D6 · in-app notifications, one row per recipient (also sent as push when the device registered). */
export const notifications = pgTable(
  'notifications',
  {
    id: idPk(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<NotificationType>().notNull(),
    title: text('title').notNull(),
    body: text('body'),
    bookingId: integer('booking_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'notifications_business_id_booking_id_fkey',
      columns: [t.businessId, t.bookingId],
      foreignColumns: [bookings.businessId, bookings.id],
    }).onDelete('cascade'),
    index('notifications_user_unread_idx').on(t.userId, t.createdAt.desc()).where(sql`${t.readAt} IS NULL`),
    index('notifications_user_created_idx').on(t.userId, t.createdAt.desc()),
    index('notifications_business_id_idx').on(t.businessId),
    check('notifications_type_check', sql.raw(`type IN (${NOTIFICATION_TYPES.map((x) => `'${x}'`).join(',')})`)),
  ],
);
