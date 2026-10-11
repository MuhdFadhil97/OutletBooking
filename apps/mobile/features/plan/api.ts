import type { PlanInfo } from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

/** E3 / E4: current plan, what the business uses, website payment links. */
export const getPlanInfo = () => apiFetch<PlanInfo>('/businesses/current/plan');
