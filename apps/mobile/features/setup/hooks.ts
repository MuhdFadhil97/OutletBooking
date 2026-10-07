import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BookingFieldCreate,
  BookingFieldUpdate,
  BusinessProfileUpdate,
  ResourceCreate,
  ResourceUpdate,
  ServiceCreate,
  ServiceUpdate,
  WorkingHourInput,
} from '@outletbooking/shared';
import * as api from './api';

export const setupKeys = {
  business: ['business'] as const,
  services: ['services'] as const,
  resources: ['resources'] as const,
  hours: (resourceId: number) => ['working-hours', resourceId] as const,
  timeOff: ['time-off'] as const,
  fields: ['booking-fields'] as const,
  summary: ['setup-summary'] as const,
};

// ------------------------------------------------------------ ST summary, payment rule, O1c finish

/** Setup tab rows. Refetched when the tab is focused, so edits made deeper in the stack show up. */
export const useSetupSummary = () => useQuery({ queryKey: setupKeys.summary, queryFn: api.getSetupSummary });

export function useSetPaymentRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.setPaymentRule,
    onSuccess: (data) => {
      qc.setQueryData(setupKeys.summary, data);
      void qc.invalidateQueries({ queryKey: setupKeys.services });
    },
  });
}

/** Sign-up step 3 "Finish": resources, hours, prices and payment rule in one call. */
export function useFinishOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.finishOnboarding,
    onSuccess: (data) => {
      qc.setQueryData(setupKeys.summary, data);
      return Promise.all(
        [setupKeys.business, setupKeys.services, setupKeys.resources, ['working-hours'], ['setup-checklist'], ['me']].map(
          (queryKey) => qc.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}

// ------------------------------------------------------------ business profile

export const useBusiness = () => useQuery({ queryKey: setupKeys.business, queryFn: api.getBusiness });

export function useUpdateBusiness() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BusinessProfileUpdate) => api.updateBusiness(body),
    onSuccess: (data) => {
      qc.setQueryData(setupKeys.business, data);
      // Name + resource label are also shown from /me
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

// ------------------------------------------------------------ services + resources
// Both carry the service↔resource links, so a change to one refreshes the other.

function useInvalidateCatalog() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: setupKeys.services }),
      qc.invalidateQueries({ queryKey: setupKeys.resources }),
    ]);
}

export const useServices = () => useQuery({ queryKey: setupKeys.services, queryFn: api.listServices });

export function useSaveService(id: number | null) {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (body: ServiceCreate | ServiceUpdate) =>
      id === null ? api.createService(body as ServiceCreate) : api.updateService(id, body),
    onSuccess: invalidate,
  });
}

/** Saves several service edits at once (sign-up step 3: review prices / durations). */
export function useUpdateServices() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (edits: { id: number; body: ServiceUpdate }[]) =>
      Promise.all(edits.map((e) => api.updateService(e.id, e.body))),
    onSuccess: invalidate,
  });
}

export function useArchiveService() {
  const invalidate = useInvalidateCatalog();
  return useMutation({ mutationFn: api.archiveService, onSuccess: invalidate });
}

export const useResources = () => useQuery({ queryKey: setupKeys.resources, queryFn: api.listResources });

export function useSaveResource(id: number | null) {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (body: ResourceCreate | ResourceUpdate) =>
      id === null ? api.createResource(body as ResourceCreate) : api.updateResource(id, body),
    onSuccess: invalidate,
  });
}

export function useArchiveResource() {
  const invalidate = useInvalidateCatalog();
  return useMutation({ mutationFn: api.archiveResource, onSuccess: invalidate });
}

// ------------------------------------------------------------ working hours

export const useWorkingHours = (resourceId: number | null) =>
  useQuery({
    queryKey: setupKeys.hours(resourceId ?? 0),
    queryFn: () => api.getWorkingHours(resourceId!),
    enabled: resourceId !== null,
  });

export function useSetWorkingHours(resourceId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (hours: WorkingHourInput[]) => api.setWorkingHours(resourceId, hours),
    onSuccess: (data) => qc.setQueryData(setupKeys.hours(resourceId), data),
  });
}

export function useCopyWorkingHours(resourceId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (toResourceIds: number[]) => api.copyWorkingHours(resourceId, toResourceIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['working-hours'] }),
  });
}

// ------------------------------------------------------------ time off

/** Upcoming and current time off (anything that ends after now). */
export const useTimeOff = () =>
  useQuery({ queryKey: setupKeys.timeOff, queryFn: () => api.listTimeOff(new Date().toISOString()) });

export function useCreateTimeOff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createTimeOff,
    onSuccess: () => qc.invalidateQueries({ queryKey: setupKeys.timeOff }),
  });
}

export function useDeleteTimeOff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteTimeOff,
    onSuccess: () => qc.invalidateQueries({ queryKey: setupKeys.timeOff }),
  });
}

// ------------------------------------------------------------ booking fields

export const useBookingFields = () => useQuery({ queryKey: setupKeys.fields, queryFn: api.listBookingFields });

export function useSaveBookingField(id: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BookingFieldCreate | BookingFieldUpdate) =>
      id === null ? api.createBookingField(body as BookingFieldCreate) : api.updateBookingField(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: setupKeys.fields }),
  });
}

export function useDeleteBookingField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteBookingField,
    onSuccess: () => qc.invalidateQueries({ queryKey: setupKeys.fields }),
  });
}

export function useReorderBookingFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.reorderBookingFields,
    onSuccess: (data) => qc.setQueryData(setupKeys.fields, data),
  });
}
