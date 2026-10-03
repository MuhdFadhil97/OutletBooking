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

export interface TemplateInfo {
  /** Default label for a bookable resource ("Court", "Bay", "Agent") */
  resourceLabel: string;
  slotIntervalMin: number;
}

export const TEMPLATE_INFO: Record<BusinessTemplate, TemplateInfo> = {
  real_estate: { resourceLabel: 'Agent', slotIntervalMin: 30 },
  vehicle_inspection: { resourceLabel: 'Bay', slotIntervalMin: 30 },
  sports: { resourceLabel: 'Court', slotIntervalMin: 60 },
  workshop: { resourceLabel: 'Bay', slotIntervalMin: 30 },
  barber_salon: { resourceLabel: 'Stylist', slotIntervalMin: 15 },
  clinic: { resourceLabel: 'Practitioner', slotIntervalMin: 15 },
  tuition: { resourceLabel: 'Teacher', slotIntervalMin: 30 },
  other: { resourceLabel: 'Resource', slotIntervalMin: 30 },
};
