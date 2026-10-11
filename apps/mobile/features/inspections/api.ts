import type {
  Checklist,
  ChecklistSaveInput,
  Inspection,
  InspectionReportLink,
  InspectionSaveInput,
  PublicInspectionReport,
} from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

/** ST-VI-C checklist. */
export const getChecklist = () => apiFetch<Checklist>('/checklist');
export const saveChecklist = (body: ChecklistSaveInput) => apiFetch<Checklist>('/checklist', { method: 'PUT', json: body });
export const loadStandardChecklist = () => apiFetch<Checklist>('/checklist/standard', { method: 'POST' });

/** S2 result per check. */
export const getInspection = (bookingId: number) => apiFetch<Inspection>(`/bookings/${bookingId}/inspection`);
export const saveInspection = (bookingId: number, body: InspectionSaveInput) =>
  apiFetch<Inspection>(`/bookings/${bookingId}/inspection`, { method: 'PUT', json: body });
export const createReportLink = (bookingId: number) =>
  apiFetch<InspectionReportLink>(`/bookings/${bookingId}/inspection/report-link`, { method: 'POST' });

/** Customer report page (no login). */
export const getPublicReport = (token: string) => apiFetch<PublicInspectionReport>(`/public/bookings/${token}/report`);
