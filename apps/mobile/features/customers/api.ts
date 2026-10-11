import type {
  CustomerCreateInput,
  CustomerFilter,
  CustomerList,
  CustomerProfile,
  CustomerUpdateInput,
} from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

/** D10: search + filter, most recent visit first. */
export const listCustomers = (p: { q?: string; filter: CustomerFilter; limit: number; offset?: number }) => {
  const qs = new URLSearchParams({ filter: p.filter, limit: String(p.limit), offset: String(p.offset ?? 0) });
  if (p.q) qs.set('q', p.q);
  return apiFetch<CustomerList>(`/customers?${qs.toString()}`);
};

export const getCustomer = (id: number) => apiFetch<CustomerProfile>(`/customers/${id}`);

export const createCustomer = (body: CustomerCreateInput) =>
  apiFetch<CustomerProfile>('/customers', { method: 'POST', json: body });

export const updateCustomer = (id: number, body: CustomerUpdateInput) =>
  apiFetch<CustomerProfile>(`/customers/${id}`, { method: 'PATCH', json: body });

/** PDPA erase: anonymises the customer; bookings and payments stay. */
export const eraseCustomer = (id: number) => apiFetch<null>(`/customers/${id}/erase`, { method: 'POST' });
