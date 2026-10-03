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

export interface TemplateInfo {
  /** Default label for a bookable resource ("Court", "Bay", "Agent") */
  resourceLabel: string;
  slotIntervalMin: number;
  services: TemplateService[];
  bookingFields: TemplateBookingField[];
}

const RM = (ringgit: number) => ringgit * 100;
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];

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
    slotIntervalMin: 30,
    services: [
      { name: 'Pre-purchase inspection', durationMin: 60, priceSen: RM(150), depositSen: RM(30) },
      { name: 'Full inspection', durationMin: 90, priceSen: RM(250), depositSen: RM(50) },
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
    slotIntervalMin: 30,
    services: [
      { name: 'Oil change', durationMin: 60, priceSen: RM(120) },
      { name: 'Full service', durationMin: 120, priceSen: RM(350) },
      { name: 'Car wash', durationMin: 30, priceSen: RM(25) },
    ],
    bookingFields: [plateNumber],
  },
  barber_salon: {
    resourceLabel: 'Stylist',
    slotIntervalMin: 15,
    services: [
      { name: 'Haircut', durationMin: 30, priceSen: RM(25) },
      { name: 'Colour', durationMin: 90, priceSen: RM(150), depositSen: RM(30) },
    ],
    bookingFields: [],
  },
  clinic: {
    resourceLabel: 'Practitioner',
    slotIntervalMin: 15,
    services: [
      { name: 'Consultation', durationMin: 15, priceSen: RM(50) },
      { name: 'Physiotherapy', durationMin: 45, priceSen: RM(120) },
    ],
    bookingFields: [],
  },
  tuition: {
    resourceLabel: 'Teacher',
    slotIntervalMin: 30,
    services: [{ name: 'Class', durationMin: 60, priceSen: RM(50) }],
    bookingFields: [{ fieldKey: 'student_name', label: 'Student name', fieldType: 'text', isRequired: true }],
  },
  other: {
    resourceLabel: 'Resource',
    slotIntervalMin: 30,
    services: [],
    bookingFields: [],
  },
};
