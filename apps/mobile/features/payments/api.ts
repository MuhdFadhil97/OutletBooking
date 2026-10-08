import type {
  Booking,
  BookingPayments,
  ManualPaymentInput,
  PaymentAccountView,
  PaymentTest,
} from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

// H1 · the business's own ToyyibPay account
export const getPaymentAccount = () => apiFetch<PaymentAccountView>('/payment-account');
export const connectPaymentAccount = (secretKey: string) =>
  apiFetch<PaymentAccountView>('/payment-account', { method: 'PUT', json: { secretKey } });
export const disconnectPaymentAccount = () => apiFetch<PaymentAccountView>('/payment-account', { method: 'DELETE' });
export const startPaymentTest = () => apiFetch<PaymentTest>('/payment-account/test', { method: 'POST' });
export const checkPaymentTest = () => apiFetch<PaymentAccountView>('/payment-account/test/check', { method: 'POST' });

// H7 · payments on one booking
export const getBookingPayments = (id: number) => apiFetch<BookingPayments>(`/bookings/${id}/payments`);
export const recordPayment = (id: number, body: ManualPaymentInput) =>
  apiFetch<Booking>(`/bookings/${id}/payments`, { method: 'POST', json: body });
export const createPayLink = (id: number) => apiFetch<{ url: string }>(`/bookings/${id}/pay-link`, { method: 'POST' });
