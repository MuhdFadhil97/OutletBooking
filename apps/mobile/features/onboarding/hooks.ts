import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChecklistUpdate } from '@outletbooking/shared';
import * as api from './api';

const checklistKey = ['setup-checklist'] as const;

export const useSetupChecklist = () => useQuery({ queryKey: checklistKey, queryFn: api.getChecklist });

/** Records "link shared" / "hide checklist". */
export function useUpdateChecklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ChecklistUpdate) => api.updateChecklist(body),
    onSuccess: (data) => qc.setQueryData(checklistKey, data),
  });
}
