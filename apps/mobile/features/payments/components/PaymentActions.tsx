import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { MANUAL_PAYMENT_METHODS, type Booking, type BookingEvent, type ManualPaymentMethod } from '@outletbooking/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { MoneyField } from '@/components/ui/MoneyField';
import { FormError, errorMessage } from '@/components/ui/ScreenState';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { showToast } from '@/components/ui/Toast';
import { formatWhen, whatsappUrl } from '@/features/bookings/format';
import { usePayLink, useRecordPayment } from '@/features/payments/hooks';
import { formatRM } from '@/lib/format';
import { formatMmSs, useCountdown } from '@/lib/use-countdown';
import { formatInTimeZone } from 'date-fns-tz';
import { t } from '@/strings/en';

const s = t.booking;

/** Still owed: the online amount due while unpaid, otherwise the rest of the price. */
export function balanceDue(b: Booking): number {
  return Math.max(0, b.priceSen - (b.paidSen - b.refundedSen));
}

/**
 * H7 · Unpaid booking: hold countdown, resend the ToyyibPay link on WhatsApp, record a payment
 * taken in person (cash / DuitNow QR / card / transfer). Only for people who can take payments.
 */
export function PaymentActions({
  booking: b,
  events,
  tz,
  disabled,
}: {
  booking: Booking;
  events: BookingEvent[] | undefined;
  tz: string;
  disabled: boolean;
}) {
  const payLink = usePayLink(b.id);
  const [recording, setRecording] = useState(false);
  const holding = b.status === 'pending' && b.paymentStatus === 'unpaid' && b.amountDueSen > 0;
  const left = useCountdown(holding ? b.expiresAt : null);
  const balance = balanceDue(b);
  const lastLink = [...(events ?? [])].reverse().find((e) => e.type === 'pay_link_sent');
  if (b.status === 'cancelled' || b.status === 'no_show' || (balance <= 0 && !holding)) return null;

  const resend = () =>
    payLink.mutate(undefined, {
      onSuccess: (l) => {
        if (!b.customer.phone) return;
        const msg = s.payLinkMessage(b.customer.name, formatRM(l.amountSen), b.service.name, formatWhen(b, tz), l.paymentUrl);
        void Linking.openURL(`${whatsappUrl(b.customer.phone)}?text=${encodeURIComponent(msg)}`);
      },
    });

  return (
    <Card className="gap-3 p-3.5">
      {holding ? (
        <View className="gap-0.5">
          <Text className="text-[15px] font-extrabold text-pend-fg">{s.awaitingPayment}</Text>
          {left !== null ? (
            <Text className="text-[13px] text-muted">
              {lastLink ? `${s.payLinkSent(formatInTimeZone(new Date(lastLink.createdAt), tz, 'h:mm a'))} · ` : ''}
              {left > 0 ? s.releasedIn(formatMmSs(left)) : s.holdReleased}
            </Text>
          ) : null}
        </View>
      ) : null}
      <FormError message={payLink.error ? errorMessage(payLink.error) : null} />
      <View className="flex-row gap-2">
        {holding ? (
          <Button
            className="flex-1"
            variant="secondary"
            title={s.resendPayLink}
            loading={payLink.isPending}
            disabled={disabled || !b.customer.phone}
            onPress={resend}
          />
        ) : null}
        <Button className="flex-1" title={s.recordPayment} disabled={disabled} onPress={() => setRecording(true)} />
      </View>
      <RecordPaymentSheet
        visible={recording}
        booking={b}
        suggestedSen={holding ? Math.min(balance, b.amountDueSen - b.paidSen) : balance}
        maxSen={balance}
        onClose={() => setRecording(false)}
      />
    </Card>
  );
}

function RecordPaymentSheet({
  visible,
  booking,
  suggestedSen,
  maxSen,
  onClose,
}: {
  visible: boolean;
  booking: Booking;
  suggestedSen: number;
  maxSen: number;
  onClose: () => void;
}) {
  const record = useRecordPayment(booking.id);
  const [amountSen, setAmountSen] = useState(suggestedSen);
  const [method, setMethod] = useState<ManualPaymentMethod>('cash');
  const [reference, setReference] = useState('');

  useEffect(() => {
    if (!visible) return;
    setAmountSen(suggestedSen);
    setMethod('cash');
    setReference('');
    record.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const invalid = !Number.isFinite(amountSen) || amountSen <= 0 || amountSen > maxSen;
  const save = () =>
    record.mutate(
      { amountSen, method, reference: reference.trim() || null },
      {
        onSuccess: () => {
          onClose();
          showToast({ message: s.paymentSaved });
        },
      },
    );

  return (
    <Sheet visible={visible} title={s.recordPayment} onClose={onClose}>
      <FormError message={record.error ? errorMessage(record.error) : null} />
      <MoneyField
        label={s.amountReceived}
        valueSen={amountSen}
        onChangeSen={setAmountSen}
        error={invalid && amountSen > maxSen ? s.refundTooLarge(formatRM(maxSen)) : undefined}
      />
      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{s.method}</Text>
        <View className="flex-row flex-wrap gap-2">
          {MANUAL_PAYMENT_METHODS.map((m) => (
            <Chip key={m} role="radio" label={s.methods[m]} selected={method === m} onPress={() => setMethod(m)} />
          ))}
        </View>
      </View>
      <TextField compact label={s.reference} value={reference} onChangeText={setReference} maxLength={100} />
      <Button title={s.savePayment} loading={record.isPending} disabled={invalid} onPress={save} />
    </Sheet>
  );
}
