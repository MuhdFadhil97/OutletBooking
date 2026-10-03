import type {
  BookingField,
  BookingFieldCreate,
  BookingFieldUpdate,
  BusinessProfile,
  BusinessProfileUpdate,
  Resource,
  ResourceCreate,
  ResourceUpdate,
  Service,
  ServiceCreate,
  ServiceUpdate,
  TimeOff,
  WorkingHour,
  WorkingHourInput,
} from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

/** Time off as sent to the API (ISO strings with offset). */
export interface TimeOffBody {
  resourceId: number | null;
  startAt: string;
  endAt: string;
  reason?: string | null;
}

// Business profile
export const getBusiness = () => apiFetch<BusinessProfile>('/businesses/current');
export const updateBusiness = (body: BusinessProfileUpdate) =>
  apiFetch<BusinessProfile>('/businesses/current', { method: 'PATCH', json: body });

// Services
export const listServices = () => apiFetch<Service[]>('/services');
export const createService = (body: ServiceCreate) => apiFetch<Service>('/services', { method: 'POST', json: body });
export const updateService = (id: number, body: ServiceUpdate) =>
  apiFetch<Service>(`/services/${id}`, { method: 'PATCH', json: body });
export const archiveService = (id: number) => apiFetch<null>(`/services/${id}`, { method: 'DELETE' });

// Resources + working hours
export const listResources = () => apiFetch<Resource[]>('/resources');
export const createResource = (body: ResourceCreate) => apiFetch<Resource>('/resources', { method: 'POST', json: body });
export const updateResource = (id: number, body: ResourceUpdate) =>
  apiFetch<Resource>(`/resources/${id}`, { method: 'PATCH', json: body });
export const archiveResource = (id: number) => apiFetch<null>(`/resources/${id}`, { method: 'DELETE' });
export const getWorkingHours = (resourceId: number) => apiFetch<WorkingHour[]>(`/resources/${resourceId}/working-hours`);
export const setWorkingHours = (resourceId: number, hours: WorkingHourInput[]) =>
  apiFetch<WorkingHour[]>(`/resources/${resourceId}/working-hours`, { method: 'PUT', json: { hours } });
export const copyWorkingHours = (resourceId: number, toResourceIds: number[]) =>
  apiFetch<null>(`/resources/${resourceId}/working-hours/copy`, { method: 'POST', json: { toResourceIds } });

// Time off
export const listTimeOff = (from?: string) =>
  apiFetch<TimeOff[]>(`/time-off${from ? `?from=${encodeURIComponent(from)}` : ''}`);
export const createTimeOff = (body: TimeOffBody) => apiFetch<TimeOff>('/time-off', { method: 'POST', json: body });
export const deleteTimeOff = (id: number) => apiFetch<null>(`/time-off/${id}`, { method: 'DELETE' });

// Booking fields
export const listBookingFields = () => apiFetch<BookingField[]>('/booking-fields');
export const createBookingField = (body: BookingFieldCreate) =>
  apiFetch<BookingField>('/booking-fields', { method: 'POST', json: body });
export const updateBookingField = (id: number, body: BookingFieldUpdate) =>
  apiFetch<BookingField>(`/booking-fields/${id}`, { method: 'PATCH', json: body });
export const deleteBookingField = (id: number) => apiFetch<null>(`/booking-fields/${id}`, { method: 'DELETE' });
export const reorderBookingFields = (ids: number[]) =>
  apiFetch<BookingField[]>('/booking-fields/order', { method: 'PUT', json: { ids } });
