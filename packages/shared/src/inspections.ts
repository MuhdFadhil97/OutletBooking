import { z } from 'zod';

/**
 * Vehicle inspection checklist & report (FR-17.6 / FR-17.7): ST-VI-C checklist setup,
 * S2 result per check, and the report the customer opens from WhatsApp.
 */
export const OVERALL_RESULTS = ['pass', 'attention', 'fail'] as const;
export type OverallResult = (typeof OVERALL_RESULTS)[number];
/** Per check: N/A = not checked on this vehicle. */
export const CHECK_OUTCOMES = ['pass', 'attention', 'fail', 'na'] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

/** Standard checklist for new vehicle inspection businesses (and "Use the standard checklist"). */
export const STANDARD_CHECKLIST: { name: string; items: string[] }[] = [
  {
    name: 'Exterior & body',
    items: ['Paint & panels', 'Signs of accident repair', 'Rust', 'Windscreen & glass', 'Lights & indicators', 'Tyres & tread depth', 'Rims'],
  },
  {
    name: 'Engine bay',
    items: ['Engine oil', 'Coolant', 'Leaks', 'Belts & hoses', 'Battery', 'Engine sound at idle', 'Signs of flood damage'],
  },
  { name: 'Interior & electrics', items: ['Air-cond', 'Dashboard warning lights', 'Power windows & mirrors', 'Seats & seat belts', 'Audio & infotainment'] },
  { name: 'Underside & suspension', items: ['Suspension & shocks', 'Exhaust', 'Chassis condition', 'Brake lines'] },
  { name: 'Road test', items: ['Brakes', 'Steering', 'Gearbox & clutch', 'Unusual noises'] },
];

const label = (max: number, message: string) => z.string().trim().min(1, message).max(max);

/** ST-VI-C · save the whole checklist. Sections / checks without `id` are new; missing ones are removed. */
export const checklistSaveSchema = z.object({
  sections: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        name: label(80, 'Enter a section name'),
        items: z
          .array(z.object({ id: z.number().int().positive().optional(), label: label(120, 'Enter the check') }))
          .max(60),
      }),
    )
    .max(20),
});
export type ChecklistSaveInput = z.input<typeof checklistSaveSchema>;
export type ChecklistSave = z.infer<typeof checklistSaveSchema>;

export interface ChecklistItem {
  id: number;
  label: string;
}
export interface ChecklistSection {
  id: number;
  name: string;
  items: ChecklistItem[];
}
export interface Checklist {
  sections: ChecklistSection[];
  /** Active checks. */
  checks: number;
}

/** Report options stored in `businesses.settings` (ST-VI-C "Report"). */
export const REPORT_SETTING_KEYS = ['reportWhatsapp', 'reportPhotos', 'reportInspectorName'] as const;
export type ReportSettingKey = (typeof REPORT_SETTING_KEYS)[number];
export interface ReportSettings {
  /** Offer "Send report on WhatsApp" when the inspection is marked done. */
  reportWhatsapp: boolean;
  /** Include job photos in the report. */
  reportPhotos: boolean;
  /** Show who inspected the vehicle. */
  reportInspectorName: boolean;
}
/** Missing settings default to on. */
export const reportSettings = (settings: Record<string, unknown>): ReportSettings => ({
  reportWhatsapp: settings.reportWhatsapp !== false,
  reportPhotos: settings.reportPhotos !== false,
  reportInspectorName: settings.reportInspectorName !== false,
});

/** S2 · save the result. Items not sent keep their last outcome. */
export const inspectionSaveSchema = z.object({
  overall: z.enum(OVERALL_RESULTS).nullable().optional(),
  items: z
    .array(
      z.object({
        itemId: z.number().int().positive(),
        outcome: z.enum(CHECK_OUTCOMES),
        note: z
          .string()
          .trim()
          .max(500)
          .nullable()
          .optional()
          .transform((v) => (v ? v : null)),
      }),
    )
    .max(500)
    .default([]),
});
export type InspectionSaveInput = z.input<typeof inspectionSaveSchema>;
export type InspectionSave = z.infer<typeof inspectionSaveSchema>;

export interface InspectionCheck extends ChecklistItem {
  outcome: CheckOutcome | null;
  note: string | null;
}
export interface InspectionSection {
  id: number;
  name: string;
  items: InspectionCheck[];
}

/** S2: the business's checklist with this booking's outcomes (removed checks only when they have one). */
export interface Inspection {
  overall: OverallResult | null;
  sections: InspectionSection[];
  reportSentAt: string | null;
  /** Owner's "Send report on WhatsApp" switch. */
  reportWhatsapp: boolean;
}

export interface InspectionReportLink {
  reportUrl: string;
  reportSentAt: string;
}

/** `/public/bookings/:token/report` — what the customer sees (only this booking). */
export interface PublicInspectionReport {
  ref: string;
  business: { name: string; phone: string | null; whatsappPhone: string | null; timezone: string };
  serviceName: string;
  startAt: string;
  completedAt: string | null;
  /** Booking answers, e.g. Plate number · WXY 1234 (only questions shown to staff). */
  details: { label: string; value: string }[];
  overall: OverallResult;
  notes: string | null;
  counts: Record<CheckOutcome, number>;
  /** Checked items only, grouped by section. */
  sections: { name: string; items: { label: string; outcome: CheckOutcome; note: string | null }[] }[];
  inspectorName: string | null;
  photos: { url: string; caption: string | null }[];
}
