import type { PaidPlan, PlanInfo } from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

/** E3 / E4: current plan, what the business uses, website payment links. */
export const getPlanInfo = () => apiFetch<PlanInfo>('/businesses/current/plan');

/**
 * A one-time link that opens the website already signed in (the website, not the app, takes plan payments):
 * the pay page with a plan chosen, or Billing & receipts. 409 `email_not_confirmed`: the owner must confirm
 * their email first; the API has just emailed them.
 */
export const getWebBillingLink = (opts: { plan?: PaidPlan; page?: 'pay' | 'account' }) =>
  apiFetch<{ url: string }>('/billing/web-link', { method: 'POST', json: opts });
