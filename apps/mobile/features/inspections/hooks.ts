import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChecklistSaveInput, Inspection, InspectionSaveInput } from '@outletbooking/shared';
import { setupKeys } from '@/features/setup/hooks';
import * as api from './api';

export const inspectionKeys = {
  checklist: ['checklist'] as const,
  booking: (bookingId: number) => ['bookings', 'inspection', bookingId] as const,
  report: (token: string) => ['public', 'report', token] as const,
};

export const useChecklist = () => useQuery({ queryKey: inspectionKeys.checklist, queryFn: api.getChecklist });

function useOnChecklistChanged() {
  const qc = useQueryClient();
  return (data: Awaited<ReturnType<typeof api.getChecklist>>) => {
    qc.setQueryData(inspectionKeys.checklist, data);
    void qc.invalidateQueries({ queryKey: setupKeys.summary });
    void qc.invalidateQueries({ queryKey: ['bookings', 'inspection'] });
  };
}

export function useSaveChecklist() {
  const onChanged = useOnChecklistChanged();
  return useMutation({ mutationFn: (body: ChecklistSaveInput) => api.saveChecklist(body), onSuccess: onChanged });
}

export function useLoadStandardChecklist() {
  const onChanged = useOnChecklistChanged();
  return useMutation({ mutationFn: api.loadStandardChecklist, onSuccess: onChanged });
}

export const useInspection = (bookingId: number, enabled = true) =>
  useQuery({ queryKey: inspectionKeys.booking(bookingId), queryFn: () => api.getInspection(bookingId), enabled: enabled && bookingId > 0 });

/** Each tap saves straight away; the screen shows the answer before the server confirms. */
export function useSaveInspection(bookingId: number) {
  const qc = useQueryClient();
  const key = inspectionKeys.booking(bookingId);
  return useMutation({
    mutationFn: (body: InspectionSaveInput) => api.saveInspection(bookingId, body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Inspection>(key);
      if (previous) {
        const outcomes = new Map((body.items ?? []).map((i) => [i.itemId, i.outcome]));
        qc.setQueryData<Inspection>(key, {
          ...previous,
          overall: body.overall !== undefined ? body.overall : previous.overall,
          sections: previous.sections.map((s) => ({
            ...s,
            items: s.items.map((i) => (outcomes.has(i.id) ? { ...i, outcome: outcomes.get(i.id)! } : i)),
          })),
        });
      }
      return { previous };
    },
    onError: (_e, _b, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous);
    },
    onSuccess: (data) => qc.setQueryData(key, data),
  });
}

export function useReportLink(bookingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.createReportLink(bookingId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: inspectionKeys.booking(bookingId) }),
  });
}

export const usePublicReport = (token: string) =>
  useQuery({ queryKey: inspectionKeys.report(token), queryFn: () => api.getPublicReport(token), enabled: /^[0-9a-f]{32}$/.test(token) });
