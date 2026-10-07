/** Business templates. Niche differences live in data like this — never in separate code paths. */
export const BUSINESS_TEMPLATES = [
  'real_estate',
  'vehicle_inspection',
  'sports',
  'workshop',
  'barber_salon',
  'clinic',
  'tuition',
  'other',
] as const;

export type BusinessTemplate = (typeof BUSINESS_TEMPLATES)[number];

export const BOOKING_FIELD_TYPES = ['text', 'number', 'select', 'date', 'address', 'phone'] as const;
export type BookingFieldType = (typeof BOOKING_FIELD_TYPES)[number];

/** Peak/off-peak override: `priceSen` applies on these weekdays (0 = Sunday) between local times "HH:MM". */
export interface TemplatePriceRule {
  name: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  priceSen: number;
}

/** Sample service an owner reviews and edits after sign-up. Prices are placeholders. */
export interface TemplateService {
  name: string;
  description?: string;
  durationMin: number;
  /** Customer-selectable durations, e.g. [60, 120, 180]. Omit for a fixed duration. */
  durationOptions?: number[];
  priceUnit?: 'per_booking' | 'per_block';
  priceSen: number;
  depositSen?: number;
  prepayFull?: boolean;
  bufferMin?: number;
  travelBufferMin?: number;
  locationType?: 'at_business' | 'at_customer_location';
  priceRules?: TemplatePriceRule[];
}

/** Extra booking-form field that applies to all services of the business. */
export interface TemplateBookingField {
  fieldKey: string;
  label: string;
  fieldType: BookingFieldType;
  options?: string[];
  isRequired?: boolean;
  isSearchable?: boolean;
}

/**
 * How customers confirm a booking, applied to every service at once (sign-up step 3, Setup "Payment to confirm"):
 *  - full: pay the whole price online · deposit: pay a deposit online, balance at the visit
 *  - at_venue: pay at the visit · none: free (e.g. property viewings)
 */
export const PAYMENT_RULES = ['full', 'deposit', 'at_venue', 'none'] as const;
export type PaymentRule = (typeof PAYMENT_RULES)[number];

/**
 * The two "Only for this type" rows on the Setup tab (ST). Some open screens that exist today;
 * the rest are shown as "Coming soon" until their phase (listings / checklist need the PRD go-ahead).
 */
export const SETUP_EXTRA_ROWS = [
  'peak_hours',
  'booking_length',
  'listings',
  'travel',
  'mobile_inspection',
  'checklist',
  'resource_schedules',
  'walk_in_queue',
  'quotes',
  'pickup_dropoff',
  'resource_label',
  'group_bookings',
] as const;
export type SetupExtraRow = (typeof SETUP_EXTRA_ROWS)[number];

/** Opening hours block in local time, "HH:MM" ("24:00" = midnight at the end of the day). */
export interface TemplateHours {
  weekdays: number[];
  startTime: string;
  endTime: string;
}

export interface TemplateInfo {
  /** Default label for a bookable resource ("Court", "Bay", "Agent") */
  resourceLabel: string;
  /** resources.resource_type for resources created in sign-up step 3. */
  resourceType: 'staff' | 'bay' | 'court' | 'room' | 'property' | 'other';
  /**
   * Sign-up step 3: `count` = "How many courts?" (Court 1, Court 2…);
   * `people` = a list of names (agents, stylists), the first one is the owner.
   */
  resourceSetup: 'count' | 'people';
  defaultResourceCount: number;
  /** "Other": label choices offered in step 3 ("What do customers book?"). */
  resourceLabelChoices?: string[];
  slotIntervalMin: number;
  services: TemplateService[];
  bookingFields: TemplateBookingField[];
  /** Setup tab "Only for this type" rows. */
  setupExtras: [SetupExtraRow, SetupExtraRow];
  /** Choices in "To confirm a booking, customers…" (first = recommended). */
  paymentRules: PaymentRule[];
  defaultPaymentRule: PaymentRule;
  /** Deposit used when the owner picks `deposit` for a service that has none yet. */
  defaultDepositSen: number;
  defaultHours: TemplateHours[];
}

const RM = (ringgit: number) => ringgit * 100;
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];
const MON_SAT = [1, 2, 3, 4, 5, 6];
const OFFICE_HOURS: TemplateHours[] = [{ weekdays: WEEKDAYS, startTime: '09:00', endTime: '18:00' }];

/** Sports peak: weekday evenings and all day on weekends. */
const sportsPeak = (priceSen: number): TemplatePriceRule[] => [
  { name: 'Peak (weekday evening)', weekdays: WEEKDAYS, startTime: '18:00', endTime: '23:00', priceSen },
  { name: 'Peak (weekend)', weekdays: WEEKEND, startTime: '08:00', endTime: '23:00', priceSen },
];

const plateNumber: TemplateBookingField = {
  fieldKey: 'plate_number',
  label: 'Plate number',
  fieldType: 'text',
  isRequired: true,
  isSearchable: true,
};

/**
 * Viewing / inspection addresses are not booking fields: services with
 * `locationType: 'at_customer_location'` collect `bookings.location_address`.
 */
export const TEMPLATE_INFO: Record<BusinessTemplate, TemplateInfo> = {
  real_estate: {
    resourceLabel: 'Agent',
    resourceType: 'staff',
    resourceSetup: 'people',
    defaultResourceCount: 1,
    setupExtras: ['listings', 'travel'],
    paymentRules: ['none', 'deposit'],
    defaultPaymentRule: 'none',
    defaultDepositSen: RM(50),
    defaultHours: [
      { weekdays: MON_SAT, startTime: '09:00', endTime: '19:00' },
      { weekdays: [0], startTime: '10:00', endTime: '17:00' },
    ],
    slotIntervalMin: 30,
    services: [
      {
        name: 'Property viewing',
        durationMin: 30,
        priceSen: 0,
        travelBufferMin: 30,
        locationType: 'at_customer_location',
      },
      { name: 'Virtual viewing', description: 'Video call walkthrough', durationMin: 20, priceSen: 0 },
    ],
    bookingFields: [
      { fieldKey: 'property_ref', label: 'Property / listing ref', fieldType: 'text', isRequired: true, isSearchable: true },
      { fieldKey: 'buyer_or_tenant', label: 'Buyer or tenant', fieldType: 'select', options: ['Buyer', 'Tenant'], isRequired: true },
      { fieldKey: 'budget', label: 'Budget (RM)', fieldType: 'number' },
    ],
  },
  vehicle_inspection: {
    resourceLabel: 'Bay',
    resourceType: 'bay',
    resourceSetup: 'count',
    defaultResourceCount: 2,
    setupExtras: ['mobile_inspection', 'checklist'],
    paymentRules: ['deposit', 'full', 'at_venue'],
    defaultPaymentRule: 'deposit',
    defaultDepositSen: RM(50),
    defaultHours: [{ weekdays: MON_SAT, startTime: '09:00', endTime: '18:00' }],
    slotIntervalMin: 30,
    services: [
      { name: 'Pre-purchase inspection', durationMin: 60, priceSen: RM(180), depositSen: RM(50) },
      { name: 'Full inspection', durationMin: 90, priceSen: RM(250), depositSen: RM(50) },
      { name: 'Post-repair check', durationMin: 45, priceSen: RM(120), depositSen: RM(50) },
      {
        name: 'Mobile inspection',
        description: 'Inspector comes to your location',
        durationMin: 90,
        priceSen: RM(300),
        depositSen: RM(50),
        travelBufferMin: 30,
        locationType: 'at_customer_location',
      },
    ],
    bookingFields: [
      plateNumber,
      { fieldKey: 'make_model', label: 'Make & model', fieldType: 'text', isRequired: true },
      { fieldKey: 'year', label: 'Year', fieldType: 'number' },
    ],
  },
  sports: {
    resourceLabel: 'Court',
    resourceType: 'court',
    resourceSetup: 'count',
    defaultResourceCount: 4,
    setupExtras: ['peak_hours', 'booking_length'],
    paymentRules: ['full', 'deposit', 'at_venue'],
    defaultPaymentRule: 'full',
    defaultDepositSen: RM(10),
    defaultHours: [
      { weekdays: WEEKDAYS, startTime: '08:00', endTime: '24:00' },
      { weekdays: WEEKEND, startTime: '07:00', endTime: '24:00' },
    ],
    slotIntervalMin: 60,
    services: [
      {
        name: 'Badminton',
        durationMin: 60,
        durationOptions: [60, 120, 180],
        priceUnit: 'per_block',
        priceSen: RM(20),
        prepayFull: true,
        priceRules: sportsPeak(RM(30)),
      },
      {
        name: 'Futsal',
        durationMin: 60,
        durationOptions: [60, 120],
        priceUnit: 'per_block',
        priceSen: RM(100),
        prepayFull: true,
        priceRules: sportsPeak(RM(150)),
      },
      {
        name: 'Pickleball',
        durationMin: 60,
        durationOptions: [60, 120],
        priceUnit: 'per_block',
        priceSen: RM(25),
        prepayFull: true,
        priceRules: sportsPeak(RM(35)),
      },
    ],
    bookingFields: [{ fieldKey: 'players', label: 'Number of players', fieldType: 'number' }],
  },
  workshop: {
    resourceLabel: 'Bay',
    resourceType: 'bay',
    resourceSetup: 'count',
    defaultResourceCount: 3,
    setupExtras: ['quotes', 'pickup_dropoff'],
    paymentRules: ['at_venue', 'deposit'],
    defaultPaymentRule: 'at_venue',
    defaultDepositSen: RM(30),
    defaultHours: [
      { weekdays: WEEKDAYS, startTime: '09:00', endTime: '18:00' },
      { weekdays: [6], startTime: '09:00', endTime: '14:00' },
    ],
    slotIntervalMin: 30,
    services: [
      { name: 'Oil change', durationMin: 60, priceSen: RM(120) },
      { name: 'Full service', durationMin: 120, priceSen: RM(350) },
      { name: 'Tyre & alignment', durationMin: 45, priceSen: RM(80) },
      { name: 'Aircond service', durationMin: 90, priceSen: RM(150) },
    ],
    bookingFields: [
      plateNumber,
      { fieldKey: 'make_model', label: 'Make & model', fieldType: 'text', isRequired: true },
      { fieldKey: 'mileage', label: 'Mileage (km)', fieldType: 'number' },
    ],
  },
  barber_salon: {
    resourceLabel: 'Stylist',
    resourceType: 'staff',
    resourceSetup: 'people',
    defaultResourceCount: 1,
    setupExtras: ['resource_schedules', 'walk_in_queue'],
    paymentRules: ['at_venue', 'deposit'],
    defaultPaymentRule: 'at_venue',
    defaultDepositSen: RM(20),
    defaultHours: [{ weekdays: [0, 2, 3, 4, 5, 6], startTime: '10:00', endTime: '21:00' }],
    slotIntervalMin: 15,
    services: [
      { name: 'Haircut', durationMin: 30, priceSen: RM(25) },
      { name: 'Hair colour', durationMin: 90, priceSen: RM(120) },
      { name: 'Beard trim', durationMin: 15, priceSen: RM(10) },
    ],
    bookingFields: [],
  },
  clinic: {
    resourceLabel: 'Practitioner',
    resourceType: 'staff',
    resourceSetup: 'people',
    defaultResourceCount: 1,
    setupExtras: ['resource_schedules', 'group_bookings'],
    paymentRules: ['at_venue', 'deposit', 'full'],
    defaultPaymentRule: 'at_venue',
    defaultDepositSen: RM(20),
    defaultHours: OFFICE_HOURS,
    slotIntervalMin: 15,
    services: [
      { name: 'Consultation', durationMin: 15, priceSen: RM(50) },
      { name: 'Physiotherapy', durationMin: 45, priceSen: RM(120) },
    ],
    bookingFields: [],
  },
  tuition: {
    resourceLabel: 'Teacher',
    resourceType: 'staff',
    resourceSetup: 'people',
    defaultResourceCount: 1,
    setupExtras: ['resource_schedules', 'group_bookings'],
    paymentRules: ['full', 'at_venue', 'deposit'],
    defaultPaymentRule: 'full',
    defaultDepositSen: RM(20),
    defaultHours: OFFICE_HOURS,
    slotIntervalMin: 30,
    services: [{ name: 'Class', durationMin: 60, priceSen: RM(50) }],
    bookingFields: [{ fieldKey: 'student_name', label: 'Student name', fieldType: 'text', isRequired: true }],
  },
  other: {
    resourceLabel: 'Room',
    resourceType: 'room',
    resourceSetup: 'count',
    defaultResourceCount: 2,
    resourceLabelChoices: ['Doctor', 'Teacher', 'Room', 'Coach', 'Equipment'],
    setupExtras: ['resource_label', 'group_bookings'],
    paymentRules: ['full', 'deposit', 'at_venue'],
    defaultPaymentRule: 'at_venue',
    defaultDepositSen: RM(20),
    defaultHours: OFFICE_HOURS,
    slotIntervalMin: 30,
    services: [],
    bookingFields: [],
  },
};
