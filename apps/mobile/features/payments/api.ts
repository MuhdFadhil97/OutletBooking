import type { Booking, PaymentAccountInfo, PaymentLink, RecordPaymentInput } from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

// H1 · the business's own ToyyibPay account (owner only)
export const getPaymentAccount = () => apiFetch<PaymentAccountInfo>('/payments/account');
export const connectToyyibPay = (secretKey: string) =>
  apiFetch<PaymentAccountInfo>('/payments/account', { method: 'POST', json: { secretKey } });
export const disconnectToyyibPay = () => apiFetch<PaymentAccountInfo>('/payments/account', { method: 'DELETE' });
export const startTestPayment = () => apiFetch<PaymentLink>('/payments/account/test', { method: 'POST', json: {} });
export const checkTestPayment = () => apiFetch<PaymentAccountInfo>('/payments/account/test/check', { method: 'POST', json: {} });

// H7 · unpaid booking
export const createPayLink = (bookingId: number) =>
  apiFetch<PaymentLink>(`/bookings/${bookingId}/pay-link`, { method: 'POST', json: {} });
export const recordPayment = (bookingId: number, body: RecordPaymentInput) =>
  apiFetch<Booking>(`/bookings/${bookingId}/payments`, { method: 'POST', json: body });

// D5 · reminders
export const listReminders = (date?: string) =>
  apiFetch<{ date: string; bookings: Booking[] }>(`/bookings/reminders${date ? `?date=${date}` : ''}`);
export const markReminderSent = (bookingId: number) =>
  apiFetch<Booking>(`/bookings/${bookingId}/reminder`, { method: 'POST', json: {} });
