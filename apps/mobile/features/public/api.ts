import type { PublicBusiness } from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

// Public booking page (no login)
export const getPublicBusiness = (slug: string) => apiFetch<PublicBusiness>(`/public/${encodeURIComponent(slug)}`);
