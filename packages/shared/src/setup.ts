import { z } from 'zod';
import { BOOKING_FIELD_TYPES } from './templates';
import { phoneE164, slugSchema } from './schemas';

/**
 * Business setup (Phase 2): profile, services, resources, working hours,
 * time off, booking fields. Used by API validation and app forms alike.
 */

export const RESOURCE_TYPES = ['staff', 'bay', 'court', 'room', 'property', 'other'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const LOCATION_TYPES = ['at_business', 'at_customer_location'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const PRICE_UNITS = ['per_booking', 'per_block'] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

/** Local wall-clock time "HH:MM" (24h). */
export const timeHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, e.g. 09:00');

/** End of a range: like timeHHMM but also "24:00" = midnight at the end of the day (Postgres `time` accepts it). */
export const endTimeHHMM = z.union([timeHHMM, z.literal('24:00')]);

/** 0 = Sunday … 6 = Saturday (matches Postgres EXTRACT(dow) and date-fns getDay). */
export const weekdaySchema = z.number().int().min(0).max(6);

/** Integer id in a URL path (authenticated routes only). */
export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const senSchema = z.number().int().min(0).max(100_000_000);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable();

const optionalPhone = z
  .union([phoneE164, z.literal('').transform(() => null)])
  .nullable();

// ---------------------------------------------------------------- profile

export const businessProfileSchema = z.object({
  name: z.string().trim().min(2, 'Enter your business name').max(100),
  phone: optionalPhone,
  whatsappPhone: optionalPhone,
  email: z
    .union([z.string().trim().toLowerCase().pipe(z.email('Enter a valid email')), z.literal('').transform(() => null)])
    .nullable(),
  address: optionalText(500),
  description: optionalText(1000),
  resourceLabel: z.string().trim().min(1, 'Enter a label').max(30),
  slotIntervalMin: z.number().int().min(5).max(240),
  minAdvanceMin: z.number().int().min(0).max(60 * 24 * 30),
  maxDaysAhead: z.number().int().min(1).max(365),
  cancelCutoffMin: z.number().int().min(0).max(60 * 24 * 30),
  /** Unpaid web bookings hold the slot this long (E6 "Hold unpaid bookings for"). */
  pendingExpiryMin: z.number().int().min(5).max(1440),
  bookingEnabled: z.boolean(),
  /** E6: paid bookings confirm automatically; off = the owner approves each one. */
  autoConfirmPaid: z.boolean(),
  /** E6 / F5: customers may cancel from their confirmation link until cancelCutoffMin before. */
  customersCanCancel: z.boolean(),
  /** E6: a late cancellation keeps the deposit. */
  lateCancelKeepsDeposit: z.boolean(),
});
/** Template-specific settings (mobile fee / area, report options, travel areas…). Shallow-merged on update. */
export const businessSettingsSchema = z
  .record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/), z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]))
  .refine((s) => Object.keys(s).length <= 50, { message: 'Too many settings' });
export const businessProfileUpdateSchema = businessProfileSchema
  .extend({ settings: businessSettingsSchema, slug: slugSchema })
  .partial();

/** E5 · Business profile form. */
export const businessDetailsSchema = businessProfileSchema
  .pick({ name: true, phone: true, whatsappPhone: true, email: true, address: true, description: true, resourceLabel: true })
  .extend({ slug: slugSchema });
export type BusinessDetailsInput = z.input<typeof businessDetailsSchema>;

/** E6 · Booking rules form. */
export const bookingRulesSchema = businessProfileSchema.pick({
  slotIntervalMin: true,
  minAdvanceMin: true,
  maxDaysAhead: true,
  cancelCutoffMin: true,
  pendingExpiryMin: true,
  bookingEnabled: true,
  autoConfirmPaid: true,
  customersCanCancel: true,
  lateCancelKeepsDeposit: true,
});
export type BookingRulesInput = z.input<typeof bookingRulesSchema>;
export type BusinessProfileInput = z.input<typeof businessProfileSchema>;
export type BusinessProfileUpdate = z.infer<typeof businessProfileUpdateSchema>;

// ---------------------------------------------------------------- services

export const priceRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(50).default('Peak'),
    weekday: weekdaySchema,
    startTime: timeHHMM,
    endTime: endTimeHHMM,
    priceSen: senSchema,
  })
  .refine((r) => r.endTime > r.startTime, { message: 'End time must be after start time', path: ['endTime'] });
export type PriceRuleInput = z.input<typeof priceRuleSchema>;

const durationMin = z.number().int().min(5).max(1440);

const serviceBase = z.object({
  name: z.string().trim().min(1, 'Enter a service name').max(100),
  description: optionalText(1000).optional(),
  durationMin,
  /** Customer-selectable lengths. null/empty = fixed duration. */
  durationOptions: z.array(durationMin).max(12).nullable().optional(),
  priceUnit: z.enum(PRICE_UNITS).default('per_booking'),
  priceSen: senSchema.default(0),
  depositSen: senSchema.default(0),
  prepayFull: z.boolean().default(false),
  bufferMin: z.number().int().min(0).max(480).default(0),
  travelBufferMin: z.number().int().min(0).max(480).default(0),
  locationType: z.enum(LOCATION_TYPES).default('at_business'),
  isVisible: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  /** Replaces the full list when given. */
  priceRules: z.array(priceRuleSchema).max(50).optional(),
  /** Resources that can perform this service. Replaces the full list when given. */
  resourceIds: z.array(z.number().int().positive()).max(200).optional(),
});

type ServiceShape = {
  durationMin?: number;
  durationOptions?: number[] | null;
  depositSen?: number;
  priceSen?: number;
  priceUnit?: PriceUnit;
};

/** Cross-field rules shared by create and update (update checks only the fields it receives). */
function checkService(s: ServiceShape, ctx: z.RefinementCtx) {
  const opts = s.durationOptions;
  if (opts && opts.length) {
    if (new Set(opts).size !== opts.length) {
      ctx.addIssue({ code: 'custom', path: ['durationOptions'], message: 'Duration options must be unique' });
    }
    if (s.durationMin !== undefined && opts.some((o) => o % s.durationMin! !== 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['durationOptions'],
        message: 'Each option must be a multiple of the base duration',
      });
    }
  }
  if (s.depositSen !== undefined && s.priceSen !== undefined && s.priceUnit !== 'per_block' && s.depositSen > s.priceSen) {
    ctx.addIssue({ code: 'custom', path: ['depositSen'], message: 'Deposit cannot be more than the price' });
  }
}

const normalizeOptions = <T extends { durationOptions?: number[] | null }>(s: T): T => ({
  ...s,
  ...(s.durationOptions !== undefined
    ? { durationOptions: s.durationOptions?.length ? [...s.durationOptions].sort((a, b) => a - b) : null }
    : {}),
});

export const serviceCreateSchema = serviceBase.superRefine(checkService).transform(normalizeOptions);
export const serviceUpdateSchema = serviceBase
  .partial()
  // .partial() keeps the defaults; drop them so a PATCH only touches what was sent.
  .extend({
    priceUnit: z.enum(PRICE_UNITS).optional(),
    priceSen: senSchema.optional(),
    depositSen: senSchema.optional(),
    prepayFull: z.boolean().optional(),
    bufferMin: z.number().int().min(0).max(480).optional(),
    travelBufferMin: z.number().int().min(0).max(480).optional(),
    locationType: z.enum(LOCATION_TYPES).optional(),
    isVisible: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .superRefine(checkService)
  .transform(normalizeOptions);
export type ServiceCreateInput = z.input<typeof serviceCreateSchema>;
export type ServiceCreate = z.infer<typeof serviceCreateSchema>;
export type ServiceUpdate = z.infer<typeof serviceUpdateSchema>;

// ---------------------------------------------------------------- resources

const resourceBase = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(100),
  resourceType: z.enum(RESOURCE_TYPES),
  /** Linked staff login (must be a member of this business). */
  userId: z.number().int().positive().nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #1E88E5')
    .nullable()
    .optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
  /** Services this resource can perform. Replaces the full list when given. */
  serviceIds: z.array(z.number().int().positive()).max(200).optional(),
});
export const resourceCreateSchema = resourceBase;
export const resourceUpdateSchema = resourceBase.partial();
export type ResourceCreate = z.infer<typeof resourceCreateSchema>;
export type ResourceUpdate = z.infer<typeof resourceUpdateSchema>;

// ---------------------------------------------------------------- working hours

export const workingHourSchema = z
  .object({ weekday: weekdaySchema, startTime: timeHHMM, endTime: endTimeHHMM })
  .refine((r) => r.endTime > r.startTime, { message: 'End time must be after start time', path: ['endTime'] });
export type WorkingHourInput = z.infer<typeof workingHourSchema>;

/** Full weekly schedule for one resource. Several ranges per day = breaks in between. */
export const workingHoursSchema = z
  .object({ hours: z.array(workingHourSchema).max(7 * 6) })
  .superRefine(({ hours }, ctx) => {
    for (let d = 0; d < 7; d++) {
      const day = hours.filter((h) => h.weekday === d).sort((a, b) => a.startTime.localeCompare(b.startTime));
      for (let i = 1; i < day.length; i++) {
        if (day[i]!.startTime < day[i - 1]!.endTime) {
          ctx.addIssue({ code: 'custom', path: ['hours'], message: `Overlapping hours on ${WEEKDAY_NAMES[d]}` });
          break;
        }
      }
    }
  });
export type WorkingHoursInput = z.infer<typeof workingHoursSchema>;

export const copyWorkingHoursSchema = z.object({
  toResourceIds: z.array(z.number().int().positive()).min(1).max(200),
});

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

// ---------------------------------------------------------------- time off

const isoDateTime = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const timeOffBase = z.object({
  /** null = whole business closed (public holiday, closure). */
  resourceId: z.number().int().positive().nullable(),
  startAt: isoDateTime,
  endAt: isoDateTime,
  reason: optionalText(200).optional(),
});
export const timeOffCreateSchema = timeOffBase.refine((t) => t.endAt > t.startAt, {
  message: 'End must be after start',
  path: ['endAt'],
});
export const timeOffUpdateSchema = timeOffBase
  .partial()
  .refine((t) => !t.startAt || !t.endAt || t.endAt > t.startAt, { message: 'End must be after start', path: ['endAt'] });
export type TimeOffCreate = z.infer<typeof timeOffCreateSchema>;
export type TimeOffUpdate = z.infer<typeof timeOffUpdateSchema>;

export const timeOffQuery = z.object({
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  resourceId: z.coerce.number().int().positive().optional(),
});

// ---------------------------------------------------------------- booking fields

/** Must match the CHECK on booking_fields.field_key */
export const fieldKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, '2–40 chars: lowercase letters, numbers, underscores; start with a letter');

/** "Plate number" → "plate_number" */
export function suggestFieldKey(label: string): string {
  const key = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (!key) return 'field';
  return /^[a-z]/.test(key) ? (key.length < 2 ? `${key}_` : key) : `f_${key}`.slice(0, 40);
}

const bookingFieldBase = z.object({
  /** null = applies to all services. */
  serviceId: z.number().int().positive().nullable().default(null),
  fieldKey: fieldKeySchema,
  label: z.string().trim().min(1, 'Enter a label').max(100),
  fieldType: z.enum(BOOKING_FIELD_TYPES),
  options: z.array(z.string().trim().min(1).max(100)).max(50).nullable().default(null),
  isRequired: z.boolean().default(false),
  isSearchable: z.boolean().default(false),
  /** Off = only the owner (and staff who can change setup) see the answer. */
  showToStaff: z.boolean().default(true),
  /** Placeholder on the booking form, e.g. "e.g. WXY 1234". */
  hint: optionalText(100).default(null),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  isActive: z.boolean().default(true),
});

function checkOptions(f: { fieldType?: string; options?: string[] | null }, ctx: z.RefinementCtx) {
  if (f.fieldType === 'select' && (!f.options || f.options.length < 2)) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least 2 options' });
  }
}

export const bookingFieldCreateSchema = bookingFieldBase
  .superRefine(checkOptions)
  .transform((f) => ({ ...f, options: f.fieldType === 'select' ? f.options : null }));
export const bookingFieldUpdateSchema = z
  .object({
    serviceId: z.number().int().positive().nullable(),
    fieldKey: fieldKeySchema,
    label: z.string().trim().min(1).max(100),
    fieldType: z.enum(BOOKING_FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(100)).max(50).nullable(),
    isRequired: z.boolean(),
    isSearchable: z.boolean(),
    showToStaff: z.boolean(),
    hint: optionalText(100),
    sortOrder: z.number().int().min(0).max(10_000),
    isActive: z.boolean(),
  })
  .partial();
export type BookingFieldCreateInput = z.input<typeof bookingFieldCreateSchema>;
export type BookingFieldCreate = z.infer<typeof bookingFieldCreateSchema>;
export type BookingFieldUpdate = z.infer<typeof bookingFieldUpdateSchema>;

export const reorderSchema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) });

// ---------------------------------------------------------------- response types

export interface BusinessProfile {
  slug: string;
  name: string;
  template: string;
  phone: string | null;
  whatsappPhone: string | null;
  email: string | null;
  address: string | null;
  description: string | null;
  timezone: string;
  currency: string;
  resourceLabel: string;
  slotIntervalMin: number;
  minAdvanceMin: number;
  maxDaysAhead: number;
  cancelCutoffMin: number;
  pendingExpiryMin: number;
  bookingEnabled: boolean;
  autoConfirmPaid: boolean;
  customersCanCancel: boolean;
  lateCancelKeepsDeposit: boolean;
  settings: Record<string, string | number | boolean | null>;
}

export interface PriceRule {
  id: number;
  name: string;
  weekday: number;
  startTime: string; // HH:MM
  endTime: string;
  priceSen: number;
}

export interface Service {
  id: number;
  name: string;
  description: string | null;
  durationMin: number;
  durationOptions: number[] | null;
  priceUnit: PriceUnit;
  priceSen: number;
  depositSen: number;
  prepayFull: boolean;
  bufferMin: number;
  travelBufferMin: number;
  locationType: LocationType;
  isVisible: boolean;
  sortOrder: number;
  priceRules: PriceRule[];
  resourceIds: number[];
}

export interface Resource {
  id: number;
  name: string;
  resourceType: ResourceType;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  linkedUser: { id: number; name: string; email: string } | null;
  serviceIds: number[];
}

export interface WorkingHour {
  id: number;
  weekday: number;
  startTime: string; // HH:MM
  endTime: string;
}

export interface TimeOff {
  id: number;
  resourceId: number | null;
  startAt: string; // ISO
  endAt: string;
  reason: string | null;
}

export interface BookingField {
  id: number;
  serviceId: number | null;
  fieldKey: string;
  label: string;
  fieldType: (typeof BOOKING_FIELD_TYPES)[number];
  options: string[] | null;
  isRequired: boolean;
  isSearchable: boolean;
  showToStaff: boolean;
  hint: string | null;
  sortOrder: number;
  isActive: boolean;
}
