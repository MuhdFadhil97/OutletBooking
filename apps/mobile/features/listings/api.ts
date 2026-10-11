import type { Listing, ListingCreateInput, ListingFilter, ListingsResponse } from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

/** ST-RE-L: search by ref / title / area, filter by status. */
export const listListings = (p: { q?: string; status: ListingFilter }) => {
  const qs = new URLSearchParams({ status: p.status });
  if (p.q) qs.set('q', p.q);
  return apiFetch<ListingsResponse>(`/listings?${qs.toString()}`);
};

export const getListing = (id: number) => apiFetch<Listing>(`/listings/${id}`);

export const createListing = (body: ListingCreateInput) => apiFetch<Listing>('/listings', { method: 'POST', json: body });

export const updateListing = (id: number, body: Partial<ListingCreateInput>) =>
  apiFetch<Listing>(`/listings/${id}`, { method: 'PATCH', json: body });

/** Archive: booked viewings keep it, customers no longer see it. */
export const deleteListing = (id: number) => apiFetch<null>(`/listings/${id}`, { method: 'DELETE' });
