import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Listing, ListingCreateInput, ListingFilter } from '@outletbooking/shared';
import { setupKeys } from '@/features/setup/hooks';
import * as api from './api';

export const listingKeys = {
  all: ['listings'] as const,
  list: (q: string, status: ListingFilter) => ['listings', 'list', q, status] as const,
  detail: (id: number) => ['listings', 'detail', id] as const,
};

export const useListings = (q: string, status: ListingFilter) =>
  useQuery({ queryKey: listingKeys.list(q, status), queryFn: () => api.listListings({ q, status }), placeholderData: keepPreviousData });

export const useListing = (id: number) =>
  useQuery({ queryKey: listingKeys.detail(id), queryFn: () => api.getListing(id), enabled: id > 0 });

function useOnListingsChanged() {
  const qc = useQueryClient();
  return (l?: Listing) => {
    if (l) qc.setQueryData(listingKeys.detail(l.id), l);
    void qc.invalidateQueries({ queryKey: ['listings', 'list'] });
    void qc.invalidateQueries({ queryKey: setupKeys.summary });
  };
}

/** Create (id null) or update. */
export function useSaveListing(id: number | null) {
  const onChanged = useOnListingsChanged();
  return useMutation({
    mutationFn: (body: ListingCreateInput) => (id ? api.updateListing(id, body) : api.createListing(body)),
    onSuccess: onChanged,
  });
}

/** Quick switch on the list (open for viewings). */
export function useToggleListing() {
  const onChanged = useOnListingsChanged();
  return useMutation({
    mutationFn: ({ id, openForViewings }: { id: number; openForViewings: boolean }) => api.updateListing(id, { openForViewings }),
    onSuccess: onChanged,
  });
}

export function useDeleteListing() {
  const onChanged = useOnListingsChanged();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteListing(id),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: listingKeys.detail(id) });
      onChanged();
    },
  });
}
