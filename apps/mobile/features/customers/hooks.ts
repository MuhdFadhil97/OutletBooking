import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CustomerCreateInput, CustomerFilter, CustomerProfile, CustomerUpdateInput } from '@outletbooking/shared';
import * as api from './api';

export const customerKeys = {
  all: ['customers'] as const,
  list: (q: string, filter: CustomerFilter, limit: number) => ['customers', 'list', q, filter, limit] as const,
  detail: (id: number) => ['customers', 'detail', id] as const,
};

/** Keeps the previous results on screen while a new search loads. */
export const useCustomers = (q: string, filter: CustomerFilter, limit: number) =>
  useQuery({
    queryKey: customerKeys.list(q, filter, limit),
    queryFn: () => api.listCustomers({ q, filter, limit }),
    placeholderData: keepPreviousData,
  });

export const useCustomer = (id: number) =>
  useQuery({ queryKey: customerKeys.detail(id), queryFn: () => api.getCustomer(id), enabled: id > 0 });

function useOnCustomerChanged() {
  const qc = useQueryClient();
  return (c: CustomerProfile) => {
    qc.setQueryData(customerKeys.detail(c.id), c);
    void qc.invalidateQueries({ queryKey: ['customers', 'list'] });
  };
}

export function useCreateCustomer() {
  const onChanged = useOnCustomerChanged();
  return useMutation({ mutationFn: (body: CustomerCreateInput) => api.createCustomer(body), onSuccess: onChanged });
}

export function useUpdateCustomer(id: number) {
  const onChanged = useOnCustomerChanged();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomerUpdateInput) => api.updateCustomer(id, body),
    onSuccess: (c) => {
      onChanged(c);
      // Name / phone show on bookings too.
      void qc.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}

export function useEraseCustomer(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.eraseCustomer(id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: customerKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: ['customers', 'list'] });
      void qc.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}
