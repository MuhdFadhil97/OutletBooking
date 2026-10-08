import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ManualPaymentInput, PaymentAccountView } from '@outletbooking/shared';
import { bookingKeys } from '@/features/bookings/hooks';
import { checklistKey } from '@/features/onboarding/hooks';
import { setupKeys } from '@/features/setup/hooks';
import * as api from './api';

export const paymentKeys = {
  account: ['payment-account'] as const,
  booking: (id: number) => ['bookings', 'payments', id] as const,
};

export const usePaymentAccount = () => useQuery({ queryKey: paymentKeys.account, queryFn: api.getPaymentAccount });

function useSetAccount() {
  const qc = useQueryClient();
  return (acc: PaymentAccountView) => {
    qc.setQueryData(paymentKeys.account, acc);
    // Setup tab row + D8 checklist show the connection.
    void qc.invalidateQueries({ queryKey: setupKeys.summary });
    void qc.invalidateQueries({ queryKey: checklistKey });
  };
}

export function useConnectPaymentAccount() {
  const set = useSetAccount();
  return useMutation({ mutationFn: api.connectPaymentAccount, onSuccess: set });
}

export function useDisconnectPaymentAccount() {
  const set = useSetAccount();
  return useMutation({ mutationFn: api.disconnectPaymentAccount, onSuccess: set });
}

export const useStartPaymentTest = () => useMutation({ mutationFn: api.startPaymentTest });

export function useCheckPaymentTest() {
  const set = useSetAccount();
  return useMutation({ mutationFn: api.checkPaymentTest, onSuccess: set });
}

export const useBookingPayments = (id: number) =>
  useQuery({ queryKey: paymentKeys.booking(id), queryFn: () => api.getBookingPayments(id), enabled: id > 0 });

export function useRecordPayment(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ManualPaymentInput) => api.recordPayment(id, body),
    onSuccess: (b) => {
      qc.setQueryData(bookingKeys.detail(id), b);
      void qc.invalidateQueries({ queryKey: bookingKeys.all });
    },
  });
}

export function useCreatePayLink(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.createPayLink(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: paymentKeys.booking(id) });
      void qc.invalidateQueries({ queryKey: bookingKeys.events(id) });
    },
  });
}
