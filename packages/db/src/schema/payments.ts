import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idPk, updatedAt } from './columns';
import { users } from './auth';
import { businesses, subscriptions } from './tenant';
import { bookings } from './bookings';

/** Online (ToyyibPay) or manual payments for bookings; plan payments (purpose = subscription). */
export const payments = pgTable(
  'payments',
  {
    id: idPk(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'restrict' }),
    bookingId: integer('booking_id'),
    subscriptionId: integer('subscription_id').references(() => subscriptions.id, { onDelete: 'restrict' }),
    purpose: text('purpose').notNull(),
    provider: text('provider').notNull().default('toyyibpay'),
    method: text('method'),
    recordedByUserId: integer('recorded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    billCode: text('bill_code').unique(),
    amountSen: integer('amount_sen').notNull(),
    status: text('status').notNull().default('pending'),
    transactionRef: text('transaction_ref'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    rawCallback: jsonb('raw_callback'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'payments_business_id_booking_id_fkey',
      columns: [t.businessId, t.bookingId],
      foreignColumns: [bookings.businessId, bookings.id],
    }).onDelete('restrict'),
    index('payments_booking_idx').on(t.bookingId),
    index('payments_business_idx').on(t.businessId, t.createdAt),
    check('payments_purpose_check', sql`${t.purpose} IN ('deposit','full_payment','balance','subscription')`),
    check('payments_provider_check', sql`${t.provider} IN ('toyyibpay','manual')`),
    check(
      'payments_method_check',
      sql`${t.method} IN ('fpx','duitnow','card','cash','duitnow_qr','bank_transfer')`,
    ),
    check('payments_amount_sen_check', sql`${t.amountSen} > 0`),
    check('payments_status_check', sql`${t.status} IN ('pending','paid','failed','expired','refunded')`),
    check('payments_target_check', sql`(${t.bookingId} IS NOT NULL) <> (${t.subscriptionId} IS NOT NULL)`),
  ],
);

/** Each business's OWN ToyyibPay connection (H1). The secret key is encrypted in the API. */
export const paymentAccounts = pgTable(
  'payment_accounts',
  {
    id: idPk(),
    businessId: integer('business_id')
      .notNull()
      .unique()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('toyyibpay'),
    secretKeyEncrypted: text('secret_key_encrypted'),
    secretKeyLast4: text('secret_key_last4'),
    categoryCode: text('category_code'),
    status: text('status').notNull().default('not_connected'),
    lastError: text('last_error'),
    testedAt: timestamp('tested_at', { withTimezone: true }),
    /** BillCode of the latest RM 1.00 test bill (H1). */
    testBillCode: text('test_bill_code'),
    connectedByUserId: integer('connected_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('payment_accounts_provider_check', sql`${t.provider} IN ('toyyibpay')`),
    check('payment_accounts_status_check', sql`${t.status} IN ('not_connected','connected','error')`),
  ],
);
