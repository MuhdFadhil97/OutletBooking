import type { Report, ReportPeriod } from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

/** O8: one period (0 = this one, -1 = the one before). */
export const getReport = (period: ReportPeriod, offset: number) =>
  apiFetch<Report>(`/reports?period=${period}&offset=${offset}`);
