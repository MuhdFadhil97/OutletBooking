import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { citext, createdAt, idPk, updatedAt } from './columns';
import { users } from './auth';
import { businesses } from './tenant';

const businessId = () =>
  integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' });

export const branches = pgTable(
  'branches',
  {
    id: idPk(),
    businessId: businessId(),
    name: text('name').notNull(),
    address: text('address'),
    phone: text('phone'),
    latitude: numeric('latitude', { precision: 9, scale: 6 }),
    longitude: numeric('longitude', { precision: 9, scale: 6 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('branches_business_id_id_key').on(t.businessId, t.id),
    index('branches_business_id_idx').on(t.businessId),
  ],
);

export const resources = pgTable(
  'resources',
  {
    id: idPk(),
    businessId: businessId(),
    branchId: integer('branch_id'),
    name: text('name').notNull(),
    resourceType: text('resource_type').notNull(),
    /** Linked staff login. */
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    unique('resources_business_id_id_key').on(t.businessId, t.id),
    foreignKey({
      name: 'resources_business_id_branch_id_fkey',
      columns: [t.businessId, t.branchId],
      foreignColumns: [branches.businessId, branches.id],
    }),
    index('resources_business_id_idx').on(t.businessId),
    index('resources_user_id_idx').on(t.userId),
    check(
      'resources_resource_type_check',
      sql`${t.resourceType} IN ('staff','bay','court','room','property','other')`,
    ),
  ],
);

export const services = pgTable(
  'services',
  {
    id: idPk(),
    businessId: businessId(),
    name: text('name').notNull(),
    description: text('description'),
    durationMin: integer('duration_min').notNull(),
    /** e.g. {60,120,180}; NULL = fixed duration. */
    durationOptions: integer('duration_options').array(),
    /** per_block = price per duration_min block. */
    priceUnit: text('price_unit').notNull().default('per_booking'),
    priceSen: integer('price_sen').notNull().default(0),
    depositSen: integer('deposit_sen').notNull().default(0),
    prepayFull: boolean('prepay_full').notNull().default(false),
    bufferMin: integer('buffer_min').notNull().default(0),
    travelBufferMin: integer('travel_buffer_min').notNull().default(0),
    locationType: text('location_type').notNull().default('at_business'),
    isVisible: boolean('is_visible').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    unique('services_business_id_id_key').on(t.businessId, t.id),
    index('services_business_id_idx').on(t.businessId),
    check('services_duration_min_check', sql`${t.durationMin} BETWEEN 5 AND 1440`),
    check('services_price_unit_check', sql`${t.priceUnit} IN ('per_booking','per_block')`),
    check('services_price_sen_check', sql`${t.priceSen} >= 0`),
    check('services_deposit_sen_check', sql`${t.depositSen} >= 0`),
    check('services_buffer_min_check', sql`${t.bufferMin} >= 0`),
    check('services_travel_buffer_min_check', sql`${t.travelBufferMin} >= 0`),
    check(
      'services_location_type_check',
      sql`${t.locationType} IN ('at_business','at_customer_location')`,
    ),
  ],
);

export const servicePriceRules = pgTable(
  'service_price_rules',
  {
    id: idPk(),
    businessId: businessId(),
    serviceId: integer('service_id').notNull(),
    name: text('name').notNull().default('Peak'),
    /** 0 = Sunday. */
    weekday: smallint('weekday').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    priceSen: integer('price_sen').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'service_price_rules_business_id_service_id_fkey',
      columns: [t.businessId, t.serviceId],
      foreignColumns: [services.businessId, services.id],
    }).onDelete('cascade'),
    index('service_price_rules_business_id_idx').on(t.businessId),
    index('service_price_rules_service_id_idx').on(t.serviceId),
    check('service_price_rules_weekday_check', sql`${t.weekday} BETWEEN 0 AND 6`),
    check('service_price_rules_price_sen_check', sql`${t.priceSen} >= 0`),
    check('service_price_rules_time_check', sql`${t.endTime} > ${t.startTime}`),
  ],
);

export const resourceServices = pgTable(
  'resource_services',
  {
    id: idPk(),
    businessId: businessId(),
    resourceId: integer('resource_id').notNull(),
    serviceId: integer('service_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('resource_services_resource_id_service_id_key').on(t.resourceId, t.serviceId),
    foreignKey({
      name: 'resource_services_business_id_resource_id_fkey',
      columns: [t.businessId, t.resourceId],
      foreignColumns: [resources.businessId, resources.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'resource_services_business_id_service_id_fkey',
      columns: [t.businessId, t.serviceId],
      foreignColumns: [services.businessId, services.id],
    }).onDelete('cascade'),
    index('resource_services_business_id_idx').on(t.businessId),
    index('resource_services_service_id_idx').on(t.serviceId),
  ],
);

export const workingHours = pgTable(
  'working_hours',
  {
    id: idPk(),
    businessId: businessId(),
    resourceId: integer('resource_id').notNull(),
    /** 0 = Sunday. Times are local (Asia/Kuala_Lumpur). */
    weekday: smallint('weekday').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'working_hours_business_id_resource_id_fkey',
      columns: [t.businessId, t.resourceId],
      foreignColumns: [resources.businessId, resources.id],
    }).onDelete('cascade'),
    index('working_hours_business_id_idx').on(t.businessId),
    index('working_hours_resource_weekday_idx').on(t.resourceId, t.weekday),
    check('working_hours_weekday_check', sql`${t.weekday} BETWEEN 0 AND 6`),
    check('working_hours_time_check', sql`${t.endTime} > ${t.startTime}`),
  ],
);

export const timeOff = pgTable(
  'time_off',
  {
    id: idPk(),
    businessId: businessId(),
    /** NULL = whole business closed (e.g. public holiday). */
    resourceId: integer('resource_id'),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    reason: text('reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'time_off_business_id_resource_id_fkey',
      columns: [t.businessId, t.resourceId],
      foreignColumns: [resources.businessId, resources.id],
    }).onDelete('cascade'),
    index('time_off_business_range_idx').on(t.businessId, t.startAt, t.endAt),
    check('time_off_range_check', sql`${t.endAt} > ${t.startAt}`),
  ],
);

export const bookingFields = pgTable(
  'booking_fields',
  {
    id: idPk(),
    businessId: businessId(),
    /** NULL = applies to all services. */
    serviceId: integer('service_id'),
    /** e.g. plate_number */
    fieldKey: text('field_key').notNull(),
    label: text('label').notNull(),
    fieldType: text('field_type').notNull(),
    /** For select: ["Buyer","Tenant"] */
    options: jsonb('options').$type<string[]>(),
    isRequired: boolean('is_required').notNull().default(false),
    isSearchable: boolean('is_searchable').notNull().default(false),
    showToStaff: boolean('show_to_staff').notNull().default(true),
    /** Placeholder, e.g. "e.g. WXY 1234". */
    hint: text('hint'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'booking_fields_business_id_service_id_fkey',
      columns: [t.businessId, t.serviceId],
      foreignColumns: [services.businessId, services.id],
    }).onDelete('cascade'),
    uniqueIndex('booking_fields_key_uidx').on(t.businessId, sql`COALESCE(${t.serviceId}, 0)`, t.fieldKey),
    index('booking_fields_business_id_idx').on(t.businessId),
    check('booking_fields_field_key_check', sql`${t.fieldKey} ~ '^[a-z][a-z0-9_]{1,39}$'`),
    check(
      'booking_fields_field_type_check',
      sql`${t.fieldType} IN ('text','number','select','date','address','phone')`,
    ),
  ],
);

export const staffInvitations = pgTable(
  'staff_invitations',
  {
    id: idPk(),
    businessId: businessId(),
    email: citext('email').notNull(),
    resourceId: integer('resource_id').references(() => resources.id, { onDelete: 'set null' }),
    role: text('role').notNull().default('staff'),
    canViewAll: boolean('can_view_all').notNull().default(false),
    canTakePayments: boolean('can_take_payments').notNull().default(true),
    canEditSetup: boolean('can_edit_setup').notNull().default(false),
    token: text('token')
      .notNull()
      .unique()
      .default(sql`encode(gen_random_bytes(24), 'hex')`),
    invitedBy: integer('invited_by')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '7 days'`),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('staff_invitations_business_id_idx').on(t.businessId),
    check('staff_invitations_role_check', sql`${t.role} IN ('owner','staff')`),
  ],
);
