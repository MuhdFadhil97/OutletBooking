import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ReportPeriod } from '@outletbooking/shared';
import * as api from './api';

export const reportKeys = {
  period: (period: ReportPeriod, offset: number) => ['reports', period, offset] as const,
};

/** Keeps the previous numbers on screen while another period loads. */
export const useReport = (period: ReportPeriod, offset: number) =>
  useQuery({
    queryKey: reportKeys.period(period, offset),
    queryFn: () => api.getReport(period, offset),
    placeholderData: keepPreviousData,
  });
