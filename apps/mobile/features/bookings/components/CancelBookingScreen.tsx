import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { REFUND_METHODS, type Booking, type BusinessProfile, type RefundMethod } from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { MoneyField } from '@/components/ui/MoneyField';
import { SwitchRow } from '@/components/ui/Rows';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { formatWhen, whatsappUrl } from '@/features/bookings/format';
import { useBooking, useCancelBooking } from '@/features/bookings/hooks';
import type { BookingsTab } from '@/features/bookings/nav';
import { useBusiness } from '@/features/setup/hooks';
import { formatDuration, formatRM } from '@/lib/format';
import { t } from '@/strings/en';

const s = t.booking.cancelScreen;
type RefundChoice = 'keep' | 'full' | 'partial';

/** D4 · Cancel booking: reason, keep or refund what was paid (recorded only), tell the customer. */
export function CancelBookingScreen({ tab: _tab }: { tab: BookingsTab }) {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const booking = useBooking(Number(idParam));
  const business = useBusiness();
  if (!booking.data || !business.data) {
    const error = booking.error ?? business.error;
    return (
      <StackScreen title={s.title}>
        {error ? <ErrorState error={error} onRetry={() => void booking.refetch()} /> : <LoadingState />}
      </StackScreen>
    );
  }
  return <CancelForm b={booking.data} business={business.data} />;
}

function CancelForm({ b, business }: { b: Booking; business: BusinessProfile }) {
  const cancel = useCancelBooking(b.id);
  const when = formatWhen(b, business.timezone);

  // What the customer paid online and has not had back yet.
  const paidSen = b.paymentStatus === 'paid' ? b.amountDueSen - b.refundedSen : 0;
  const what: 'deposit' | 'full' = b.amountDueSen >= b.priceSen ? 'full' : 'deposit';
  const minutesToStart = (new Date(b.startAt).getTime() - Date.now()) / 60_000;
  const late = minutesToStart < business.cancelCutoffMin;
  const keepsByPolicy = late && business.lateCancelKeepsDeposit;

  const [reason, setReason] = useState<string>(s.reasons[0]!);
  const [otherText, setOtherText] = useState('');
  const [refund, setRefund] = useState<RefundChoice>(paidSen > 0 && !keepsByPolicy ? 'full' : 'keep');
  const [partialSen, setPartialSen] = useState(0);
  const [method, setMethod] = useState<RefundMethod>('bank_transfer');
  const [tell, setTell] = useState(!!b.customer.phone);
  const [error, setError] = useState<string | null>(null);

  const refundSen = refund === 'full' ? paidSen : refund === 'partial' ? partialSen : 0;

  const submit = () => {
    if (refund === 'partial' && (partialSen <= 0 || partialSen > paidSen)) return setError(s.amountInvalid);
    setError(null);
    const finalReason = reason === s.other ? otherText.trim() || s.other : reason;
    cancel.mutate(
      { reason: finalReason, ...(refundSen > 0 ? { refund: { amountSen: refundSen, method } } : {}) },
      {
        onSuccess: () => {
          if (tell && b.customer.phone) {
            const text = s.whatsappText(b.customer.name, business.name, when, refundSen > 0 ? formatRM(refundSen) : null);
            void Linking.openURL(`${whatsappUrl(b.customer.phone)}?text=${encodeURIComponent(text)}`);
          }
          router.back();
        },
      },
    );
  };

  return (
    <StackScreen
      title={s.title}
      subtitle={`${b.customer.name} · ${when}`}
      footer={
        <View className="gap-2">
          <Button variant="danger" title={s.confirm} loading={cancel.isPending} onPress={submit} />
          <Button variant="secondary" title={s.keepBooking} disabled={cancel.isPending} onPress={() => router.back()} />
        </View>
      }
    >
      <FormError message={error ?? (cancel.error ? errorMessage(cancel.error) : null)} />

      <Text className="text-[13px] font-bold text-label">{s.reason}</Text>
      <View className="flex-row flex-wrap gap-2">
        {s.reasons.map((r) => (
          <Chip key={r} role="radio" label={r} selected={reason === r} onPress={() => setReason(r)} />
        ))}
      </View>
      {reason === s.other ? <TextField compact label={s.otherReason} value={otherText} onChangeText={setOtherText} maxLength={300} /> : null}

      {paidSen > 0 ? (
        <>
          <Text className="text-[13px] font-bold text-label">{s.paid(what, formatRM(paidSen))}</Text>
          <Card className="overflow-hidden">
            <Choice
              selected={refund === 'keep'}
              title={s.keep(what)}
              hint={keepsByPolicy ? s.lateNote(formatDuration(business.cancelCutoffMin)) : undefined}
              onPress={() => setRefund('keep')}
            />
            <Choice selected={refund === 'full'} title={s.fullRefund(formatRM(paidSen))} hint={s.fullRefundHint} onPress={() => setRefund('full')} />
            <Choice selected={refund === 'partial'} title={s.partialRefund} hint={s.partialHint} onPress={() => setRefund('partial')} last />
          </Card>
          {refund === 'partial' ? <MoneyField label={s.amount} valueSen={partialSen} onChangeSen={setPartialSen} /> : null}
          {refund !== 'keep' ? (
            <>
              <Text className="text-[13px] font-bold text-label">{s.howRefunded}</Text>
              <View className="flex-row flex-wrap gap-2">
                {REFUND_METHODS.map((m) => (
                  <Chip key={m} role="radio" label={s.methods[m]} selected={method === m} onPress={() => setMethod(m)} />
                ))}
              </View>
              <Text className="text-[12px] text-muted">{s.outsideNote}</Text>
            </>
          ) : null}
        </>
      ) : null}

      {b.customer.phone ? (
        <Card className="p-3.5">
          <SwitchRow label={s.tellCustomer} hint={s.tellCustomerHint} value={tell} onChange={setTell} />
        </Card>
      ) : null}
    </StackScreen>
  );
}

function Choice({ selected, title, hint, onPress, last }: { selected: boolean; title: string; hint?: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      className={`min-h-[56px] flex-row items-center gap-3 px-3.5 py-3 active:bg-pressed ${last ? '' : 'border-b border-border'}`}
    >
      <View className={`h-5 w-5 items-center justify-center rounded-full border-2 ${selected ? 'border-primary' : 'border-input-border'}`}>
        {selected ? <View className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-[15px] font-bold">{title}</Text>
        {hint ? <Text className="text-[12px] text-muted">{hint}</Text> : null}
      </View>
    </Pressable>
  );
}
