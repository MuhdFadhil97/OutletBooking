import type { MeResponse } from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

export const getMe = () => apiFetch<MeResponse>('/me');
