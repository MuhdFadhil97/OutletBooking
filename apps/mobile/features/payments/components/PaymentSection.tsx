import { useState, type ReactNode } from 'react';
import { Linking, Share, View } from 'react-native';
import { formatInTimeZone } from 'date-fns-tz';
import { MANUAL_PAYMENT_METHODS, manualPaymentSchema, type Booking, type ManualPaymentMethod } from '@outletbooking/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChipChoice } from '@/components/ui/Chip';
import { MoneyField } from '@/components/ui/MoneyField';
import { FormError, errorMessage } from '@/components/ui/ScreenState';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { whatsappUrl } from '@/features/bookings/format';
import { formatRM } from '@/lib/format';
import { mmss, useCountdown } from '@/lib/use-countdown';
import { t } from '@/strings/en';
import { useBookingPayments, useCreatePayLink, useRecordPayment } from '../hooks';

const s = t.booking;
const p = t.payments;

/**
 * O4 payment card + H7 unpaid booking: total / paid / to pay, hold countdown, pay link,
 * record a payment received in person, and the payments so far.
 */
export function PaymentSection({ b, tz, businessName, canTakePayments }: { b: Booking; tz: string; businessName: string; canTakePayments: boolean }) {
  const payments = useBookingPayments(b.id);
  const link = useCreatePayLink(b.id);
  const toast = useToast();
  const [recording, setRecording] = useState(false);
  const left = useCountdown(b.status === 'pending' ? b.expiresAt : null);

  if (b.priceSen === 0) {
    return (
      <Section title={s.payment}>
        <Row label={s.total} value={s.free} />
      </Section>
    );
  }

  const open = b.status === 'pending' || b.status === 'confirmed' || b.status === 'checked_in';
  const balance = Math.max(0, b.priceSen - b.paidSen);
  const unpaidOnline = b.paymentStatus === 'unpaid' && b.amountDueSen > 0 && (b.status === 'pending' || b.status === 'confirmed');
  const mode = b.amountDueSen >= b.priceSen ? 'full' : 'deposit';
  const data = payments.data;
  const linkSentAt = data?.payLink?.createdAt;

  const sendLink = () =>
    link.mutate(undefined, {
      onSuccess: async ({ url }) => {
        const message = p.payLinkMessage(b.customer.name.split(' ')[0] ?? '', businessName, formatRM(b.amountDueSen), url);
        if (b.customer.phone) await Linking.openURL(`${whatsappUrl(b.customer.phone)}?text=${encodeURIComponent(message)}`);
        else await Share.share({ message }).catch(() => undefined);
      },
    });

  return (
    <Section title={unpaidOnline ? p.awaiting : s.payment}>
      <Row label={s.total} value={formatRM(b.priceSen)} />
      {b.amountDueSen > 0 ? (
        <Row
          label={`${s.dueOnline(mode)} · ${s.paymentStatus[b.paymentStatus]}`}
          value={formatRM(b.amountDueSen)}
          tone={b.paymentStatus === 'paid' ? 'ok' : undefined}
        />
      ) : null}
      <Row label={p.paid} value={formatRM(b.paidSen)} tone={b.paidSen > 0 ? 'ok' : undefined} />
      {/* Nothing is owed on a cancelled or no-show booking. */}
      {b.status !== 'cancelled' && b.status !== 'no_show' ? <Row label={s.balance} value={formatRM(balance)} /> : null}
      {b.refundedSen > 0 ? <Row label={s.refunded} value={formatRM(b.refundedSen)} /> : null}

      {unpaidOnline && (linkSentAt || left !== null) ? (
        <View className="rounded-input bg-pend-bg px-3 py-2.5">
          <Text className="text-[13px] font-semibold text-pend-fg">
            {[linkSentAt ? p.linkSent(formatInTimeZone(linkSentAt, tz, 'h:mm a')) : null, left !== null ? p.releasedIn(mmss(left)) : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      ) : null}

      {data?.items.length ? (
        <View className="gap-1 border-t border-border pt-2.5">
          {data.items
            .filter((i) => i.status === 'paid' || i.status === 'refunded')
            .map((i) => (
              <Text key={i.id} className="text-[13px] text-muted">
                {p.history(
                  formatRM(i.amountSen),
                  [i.method ? p.methods[i.method] : p.online, i.reference, i.recordedBy].filter(Boolean).join(' · '),
                  formatInTimeZone(i.paidAt ?? i.createdAt, tz, 'd MMM, h:mm a'),
                )}
              </Text>
            ))}
        </View>
      ) : null}

      <FormError message={link.error ? errorMessage(link.error) : null} />
      {canTakePayments && open && (unpaidOnline || balance > 0) ? (
        <View className="gap-2 pt-1">
          {unpaidOnline && data?.onlineAvailable ? (
            <Button variant="secondary" title={linkSentAt ? p.resendLink : p.sendLink} loading={link.isPending} onPress={sendLink} />
          ) : null}
          {balance > 0 ? <Button variant="secondary" title={p.recordPayment} onPress={() => setRecording(true)} /> : null}
          {unpaidOnline && data && !data.onlineAvailable ? <Text className="text-[12px] text-muted">{p.noOnline}</Text> : null}
        </View>
      ) : null}

      <RecordPaymentSheet
        visible={recording}
        bookingId={b.id}
        suggestedSen={b.paymentStatus === 'unpaid' && b.amountDueSen > 0 ? Math.min(b.amountDueSen, balance) : balance}
        maxSen={balance}
        onClose={() => setRecording(false)}
        onSaved={() => {
          setRecording(false);
          toast(p.paymentSaved);
        }}
      />
    </Section>
  );
}

/** H7 · "Record payment" sheet: amount, method (cash · DuitNow QR · card · bank transfer), reference. */
function RecordPaymentSheet({
  visible,
  bookingId,
  suggestedSen,
  maxSen,
  onClose,
  onSaved,
}: {
  visible: boolean;
  bookingId: number;
  suggestedSen: number;
  maxSen: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const save = useRecordPayment(bookingId);
  const [amountSen, setAmountSen] = useState(suggestedSen);
  const [method, setMethod] = useState<ManualPaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | undefined>();

  const onSave = () => {
    const parsed = manualPaymentSchema.safeParse({ amountSen, method, reference: reference || undefined });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    if (amountSen > maxSen) return setError(`Up to ${formatRM(maxSen)}`);
    setError(undefined);
    save.mutate(parsed.data, { onSuccess: onSaved });
  };

  return (
    <Sheet visible={visible} title={p.recordPayment} onClose={onClose}>
      <MoneyField label={p.amountReceived} valueSen={amountSen} onChangeSen={setAmountSen} error={error} />
      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{p.method}</Text>
        <ChipChoice options={MANUAL_PAYMENT_METHODS} value={method} onChange={setMethod} format={(m) => p.methods[m]} />
      </View>
      <TextField compact label={p.reference} value={reference} onChangeText={setReference} autoCapitalize="none" />
      <FormError message={save.error ? errorMessage(save.error) : null} />
      <Button title={p.savePayment} loading={save.isPending} onPress={onSave} />
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="gap-2.5 p-3.5">
      <Text className="text-[12px] font-extrabold uppercase tracking-[0.6px] text-muted">{title}</Text>
      {children}
    </Card>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'ok' }) {
  return (
    <View className="flex-row justify-between gap-3">
      <Text className="flex-shrink text-[14px] text-muted">{label}</Text>
      <Text className={`flex-1 text-right text-[14px] font-bold ${tone === 'ok' ? 'text-ok-fg' : ''}`}>{value}</Text>
    </View>
  );
}
