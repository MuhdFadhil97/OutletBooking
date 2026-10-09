import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Booking, PaymentAccountInfo, RecordPaymentInput } from '@outletbooking/shared';
import { bookingKeys } from '@/features/bookings/hooks';
import * as api from './api';

export const paymentKeys = {
  account: ['payments', 'account'] as const,
  reminders: ['bookings', 'reminders'] as const,
};

export const usePaymentAccount = (enabled = true) =>
  useQuery({ queryKey: paymentKeys.account, queryFn: api.getPaymentAccount, enabled });

/** Connect / disconnect / test: every answer is the new account state. */
function useAccountMutation<T>(fn: (v: T) => Promise<PaymentAccountInfo>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (info) => {
      qc.setQueryData(paymentKeys.account, info);
      // D8 checklist step "Connect ToyyibPay" and the Setup summary.
      void qc.invalidateQueries({ queryKey: ['setup-checklist'] });
      void qc.invalidateQueries({ queryKey: ['setup-summary'] });
    },
  });
}

export const useConnectToyyibPay = () => useAccountMutation((key: string) => api.connectToyyibPay(key));
export const useDisconnectToyyibPay = () => useAccountMutation((_: void) => api.disconnectToyyibPay());
export const useCheckTestPayment = () => useAccountMutation((_: void) => api.checkTestPayment());
export const useStartTestPayment = () => useMutation({ mutationFn: api.startTestPayment });

/** Any change to a booking's payments refreshes the booking, its timeline and the lists. */
function useOnBookingPaid() {
  const qc = useQueryClient();
  return (b: Booking) => {
    qc.setQueryData(bookingKeys.detail(b.id), b);
    void qc.invalidateQueries({ queryKey: bookingKeys.events(b.id) });
    void qc.invalidateQueries({ queryKey: ['bookings', 'range'] });
    void qc.invalidateQueries({ queryKey: ['bookings', 'search'] });
  };
}

export function usePayLink(bookingId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.createPayLink(bookingId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: bookingKeys.events(bookingId) }),
  });
}

export function useRecordPayment(bookingId: number) {
  const onPaid = useOnBookingPaid();
  return useMutation({ mutationFn: (body: RecordPaymentInput) => api.recordPayment(bookingId, body), onSuccess: onPaid });
}

export const useReminders = () => useQuery({ queryKey: paymentKeys.reminders, queryFn: () => api.listReminders() });

export function useMarkReminderSent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: number) => api.markReminderSent(bookingId),
    onSuccess: (b) =>
      qc.setQueryData<{ date: string; bookings: Booking[] }>(paymentKeys.reminders, (old) =>
        old ? { ...old, bookings: old.bookings.map((x) => (x.id === b.id ? b : x)) } : old,
      ),
  });
}
