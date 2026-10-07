import type { ChecklistUpdate, SetupChecklist } from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

// D8 · first-time Today setup checklist (owner only)
export const getChecklist = () => apiFetch<SetupChecklist>('/businesses/current/checklist');
export const updateChecklist = (body: ChecklistUpdate) =>
  apiFetch<SetupChecklist>('/businesses/current/checklist', { method: 'POST', json: body });
