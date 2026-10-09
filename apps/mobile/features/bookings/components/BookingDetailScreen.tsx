import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { formatInTimeZone } from 'date-fns-tz';
import {
  REFUND_METHODS,
  type Booking,
  type BookingEvent,
  type BookingStatus,
  type RefundInput,
  type RefundMethod,
  type Service,
} from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Icon, type IconName } from '@/components/ui/Icon';
import { MoneyField } from '@/components/ui/MoneyField';
import { RadioRow, SwitchRow } from '@/components/ui/Rows';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Sheet } from '@/components/ui/Sheet';
import { Tag } from '@/components/ui/Tag';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { showToast } from '@/components/ui/Toast';
import { formatPhone, formatWhen, mapsUrl, statusTone, wazeUrl, whatsappUrl } from '@/features/bookings/format';
import { useBooking, useBookingEvents, useExtendBooking, useSetBookingStatus } from '@/features/bookings/hooks';
import { openBookingForm, type BookingsTab } from '@/features/bookings/nav';
import { useBookingFields, useBusiness, useServices } from '@/features/setup/hooks';
import { confirm } from '@/lib/confirm';
import { formatDuration, formatRM } from '@/lib/format';
import { useIsOffline } from '@/lib/network';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.booking;

/** O4 · Booking detail: customer, appointment, answers, payment, timeline (H8), status actions. */
export function BookingDetailScreen({ tab }: { tab: BookingsTab }) {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const booking = useBooking(id);
  const events = useBookingEvents(id);
  const business = useBusiness();
  const services = useServices();
  const fields = useBookingFields();
  const setStatus = useSetBookingStatus(id);
  const extend = useExtendBooking(id);
  const offline = useIsOffline();
  const [cancelling, setCancelling] = useState(false);

  if (!booking.data || !business.data) {
    const error = booking.error ?? business.error;
    return (
      <StackScreen title={s.appointment}>
        {error ? <ErrorState error={error} onRetry={() => void booking.refetch()} /> : <LoadingState />}
      </StackScreen>
    );
  }

  const b = booking.data;
  const tz = business.data.timezone;
  const service = services.data?.find((x) => x.id === b.service.id);
  const atCustomer = service?.locationType === 'at_customer_location' || !!b.locationAddress;
  const labels = new Map((fields.data ?? []).map((f) => [f.fieldKey, f.label]));
  const answers = Object.entries(b.customFields).filter(([, v]) => v !== '');
  const phone = b.customer.phone;
  const extendBy = service ? extensionFor(service, b) : null;
  const lateCancel = new Date(b.startAt).getTime() - Date.now() < business.data.cancelCutoffMin * 60_000;

  const change = (status: BookingStatus) => setStatus.mutate({ status });
  const onNoShow = async () => {
    if (await confirm(s.noShowTitle, s.noShowBody, s.noShow)) change('no_show');
  };
  const onCancel = (reason: string | null, refund: RefundInput | undefined, tell: boolean) =>
    setStatus.mutate(
      { status: 'cancelled', reason, refund },
      {
        onSuccess: () => {
          setCancelling(false);
          if (tell && phone) {
            const msg = s.cancelMessage(b.customer.name, b.service.name, formatWhen(b, tz), refund ? formatRM(refund.amountSen) : null);
            void Linking.openURL(`${whatsappUrl(phone)}?text=${encodeURIComponent(msg)}`);
          }
        },
      },
    );
  const onExtend = () => extend.mutate(undefined, { onSuccess: () => showToast({ message: s.extended }) });
  const reschedule = () => openBookingForm(tab, { bookingId: String(b.id) });
  const mutationError = setStatus.error ?? extend.error;

  return (
    <StackScreen
      title={b.service.name}
      subtitle={`${b.resource.name} · ${s.source[b.source]}`}
      right={<Tag label={s.status[b.status]} tone={statusTone[b.status]} />}
    >
      <FormError message={mutationError && !cancelling ? errorMessage(mutationError) : null} />

      <Card className="flex-row items-center gap-3 p-3.5">
        <View className="h-11 w-11 items-center justify-center rounded-full bg-info-bg">
          <Text className="font-extrabold text-info-fg">{initials(b.customer.name)}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-[15px] font-extrabold" numberOfLines={1}>
            {b.customer.name}
          </Text>
          {phone ? <Text className="text-[13px] text-muted">{formatPhone(phone)}</Text> : null}
        </View>
        {phone ? (
          <>
            <RoundButton icon="phone" label={s.call} onPress={() => void Linking.openURL(`tel:${phone}`)} />
            <RoundButton icon="chat" label={s.whatsapp} primary onPress={() => void Linking.openURL(whatsappUrl(phone))} />
          </>
        ) : null}
      </Card>

      <Section title={s.appointment}>
        <Row label={s.when} value={formatWhen(b, tz)} />
        <Row label={business.data.resourceLabel} value={b.resource.name} />
        <Row label={s.where} value={atCustomer ? s.atCustomer : s.atBusiness} />
        {b.locationAddress ? (
          <View className="gap-1">
            <Text className="text-[14px] font-semibold">{b.locationAddress}</Text>
            <View className="flex-row gap-4">
              <MapLink label={s.openMaps} url={mapsUrl(b.locationAddress)} />
              <MapLink label={s.openWaze} url={wazeUrl(b.locationAddress)} />
            </View>
          </View>
        ) : null}
      </Section>

      {answers.length ? (
        <Section title={s.details}>
          {answers.map(([k, v]) => (
            <Row key={k} label={labels.get(k) ?? k} value={String(v)} />
          ))}
        </Section>
      ) : null}

      <PaymentSection b={b} />

      {b.customerNotes || b.internalNotes || b.cancelReason ? (
        <Section title={s.notesTitle}>
          {b.customerNotes ? <Note label={s.notes} text={b.customerNotes} /> : null}
          {b.internalNotes ? <Note label={s.internalNotes} text={b.internalNotes} /> : null}
          {b.cancelReason ? <Text className="text-[14px] text-muted">{s.cancelledReason(b.cancelReason)}</Text> : null}
        </Section>
      ) : null}

      {events.data?.length ? <Timeline events={events.data} status={b.status} tz={tz} /> : null}

      <Actions
        status={b.status}
        busy={setStatus.isPending}
        disabled={offline}
        onChange={change}
        onNoShow={() => void onNoShow()}
        onCancel={() => setCancelling(true)}
        onReschedule={reschedule}
        extendLabel={extendBy ? s.extend(formatDuration(extendBy)) : null}
        extending={extend.isPending}
        onExtend={onExtend}
      />

      <CancelSheet
        visible={cancelling}
        booking={b}
        lateCancel={lateCancel}
        busy={setStatus.isPending}
        error={cancelling && setStatus.error ? errorMessage(setStatus.error) : null}
        onClose={() => setCancelling(false)}
        onConfirm={onCancel}
      />
    </StackScreen>
  );
}

/** One more block, if the service offers that length (same rule as the API). */
function extensionFor(service: Service, b: Booking): number | null {
  if (b.status !== 'confirmed' && b.status !== 'checked_in') return null;
  const options = service.durationOptions?.length ? service.durationOptions : [service.durationMin];
  return options.includes(b.durationMin + service.durationMin) ? service.durationMin : null;
}

function PaymentSection({ b }: { b: Booking }) {
  if (b.priceSen === 0 && b.paidSen === 0) {
    return (
      <Section title={s.payment}>
        <Row label={s.total} value={s.free} />
      </Section>
    );
  }
  const mode = b.amountDueSen >= b.priceSen ? 'full' : 'deposit';
  const active = b.status !== 'cancelled' && b.status !== 'no_show';
  return (
    <Section title={s.payment}>
      <Row label={s.total} value={formatRM(b.priceSen)} />
      {b.amountDueSen > 0 && b.paidSen === 0 ? (
        <Row label={`${s.dueOnline(mode)} · ${s.paymentStatus[b.paymentStatus]}`} value={formatRM(b.amountDueSen)} />
      ) : null}
      {b.paidSen > 0 ? <Row label={s.paidSoFar} value={formatRM(b.paidSen)} tone="ok" /> : null}
      {b.refundedSen > 0 ? <Row label={s.refunded} value={`− ${formatRM(b.refundedSen)}`} /> : null}
      {active ? <Row label={s.balance} value={formatRM(Math.max(0, b.priceSen - b.paidSen))} /> : null}
    </Section>
  );
}

/** H8: what happened to this booking, oldest first; the next step is shown while it is open. */
function Timeline({ events, status, tz }: { events: BookingEvent[]; status: BookingStatus; tz: string }) {
  return (
    <Section title={s.timeline}>
      {events.map((e, i) => (
        <TimelineItem key={e.id} title={eventTitle(e)} sub={`${eventWho(e)} · ${formatInTimeZone(new Date(e.createdAt), tz, 'd MMM, h:mm a')}`} done last={i === events.length - 1 && status !== 'checked_in'} />
      ))}
      {status === 'checked_in' ? <TimelineItem title={s.events.completed} sub={s.completedNext} last /> : null}
    </Section>
  );
}

function eventTitle(e: BookingEvent): string {
  const amount = typeof e.details.amountSen === 'number' ? formatRM(e.details.amountSen) : null;
  if (e.type === 'refunded' && amount) return `${s.events.refunded} · ${amount}`;
  if (e.type === 'extended' && typeof e.details.toDurationMin === 'number') {
    return `${s.events.extended} · ${formatDuration(e.details.toDurationMin)}`;
  }
  return s.events[e.type];
}

function eventWho(e: BookingEvent): string {
  if (e.actor) return s.eventBy(e.actor.name);
  if (e.details.source === 'web') return s.eventOnline;
  return e.type === 'cancelled' ? s.eventCustomer : s.eventSystem;
}

function TimelineItem({ title, sub, done, last }: { title: string; sub: string; done?: boolean; last?: boolean }) {
  return (
    <View className="flex-row gap-3">
      <View className="items-center">
        <View className={`mt-1 h-3 w-3 rounded-full ${done ? 'bg-primary' : 'border-2 border-input-border bg-card'}`} />
        {last ? null : <View className="w-0.5 flex-1 bg-border" />}
      </View>
      <View className="flex-1 pb-2">
        <Text className={`text-[14px] font-bold ${done ? '' : 'text-muted'}`}>{title}</Text>
        <Text className="text-[12px] text-muted">{sub}</Text>
      </View>
    </View>
  );
}

/** Primary action first (wireframe: Check in / Mark completed), then the secondary ones. */
function Actions({
  status,
  busy,
  disabled,
  onChange,
  onNoShow,
  onCancel,
  onReschedule,
  extendLabel,
  extending,
  onExtend,
}: {
  status: BookingStatus;
  busy: boolean;
  disabled: boolean;
  onChange: (s: BookingStatus) => void;
  onNoShow: () => void;
  onCancel: () => void;
  onReschedule: () => void;
  extendLabel: string | null;
  extending: boolean;
  onExtend: () => void;
}) {
  const primary: Partial<Record<BookingStatus, { label: string; to: BookingStatus }>> = {
    pending: { label: s.confirm, to: 'confirmed' },
    confirmed: { label: s.checkIn, to: 'checked_in' },
    checked_in: { label: s.complete, to: 'completed' },
  };
  const p = primary[status];
  const open = status === 'pending' || status === 'confirmed';
  if (!p) return null;
  return (
    <View className="gap-2">
      <Button title={p.label} loading={busy} disabled={disabled} onPress={() => onChange(p.to)} />
      {status === 'checked_in' && extendLabel ? (
        <Button title={extendLabel} variant="secondary" loading={extending} disabled={disabled} onPress={onExtend} />
      ) : null}
      {open ? (
        <View className="flex-row gap-2">
          <SmallButton label={t.booking.rescheduleTitle} disabled={disabled} onPress={onReschedule} />
          {status === 'confirmed' ? <SmallButton label={s.noShow} disabled={disabled} onPress={onNoShow} /> : null}
          <SmallButton label={s.cancel} danger disabled={disabled} onPress={onCancel} />
        </View>
      ) : null}
      {status === 'checked_in' ? <Text className="text-center text-[12px] text-muted">{s.noShowAfterCheckIn}</Text> : null}
    </View>
  );
}

type RefundChoice = 'keep' | 'full' | 'partial';

/** D4: reason, keep deposit / full / partial refund, how it was refunded, tell the customer. */
function CancelSheet({
  visible,
  booking: b,
  lateCancel,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  booking: Booking;
  lateCancel: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reason: string | null, refund: RefundInput | undefined, tell: boolean) => void;
}) {
  const refundable = b.paidSen - b.refundedSen;
  const [reason, setReason] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const [choice, setChoice] = useState<RefundChoice>('keep');
  const [partialSen, setPartialSen] = useState(0);
  const [method, setMethod] = useState<RefundMethod>('bank_transfer');
  const [tell, setTell] = useState(!!b.customer.phone);

  useEffect(() => {
    if (visible) {
      setReason(null);
      setOther('');
      setChoice('keep');
      setPartialSen(0);
    }
  }, [visible]);

  const amountSen = choice === 'full' ? refundable : choice === 'partial' ? partialSen : 0;
  const partialInvalid = choice === 'partial' && (!Number.isFinite(partialSen) || partialSen <= 0 || partialSen > refundable);
  const finalReason = reason === s.reasonOther ? other.trim() || null : reason;
  const isDeposit = b.amountDueSen > 0 && b.amountDueSen < b.priceSen;

  return (
    <Sheet visible={visible} title={s.cancelTitle} onClose={onClose}>
      <Text className="text-[14px] text-muted">{b.customer.name}</Text>
      <FormError message={error} />

      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{s.cancelReason}</Text>
        <View className="flex-row flex-wrap gap-2">
          {[...s.reasons, s.reasonOther].map((r) => (
            <Chip key={r} role="radio" label={r} selected={reason === r} onPress={() => setReason(r)} />
          ))}
        </View>
        {reason === s.reasonOther ? (
          <TextField compact label={s.cancelReason} hint={s.cancelReasonHint} value={other} onChangeText={setOther} maxLength={300} />
        ) : null}
      </View>

      {refundable > 0 ? (
        <View className="gap-1">
          <Text className="text-[13px] font-bold text-label">
            {s.paidLabel(isDeposit ? s.depositWord : s.paymentWord, formatRM(refundable))}
          </Text>
          <RadioRow label={s.keepDeposit} hint={s.keepDepositHint(lateCancel)} selected={choice === 'keep'} onPress={() => setChoice('keep')} />
          <RadioRow label={s.fullRefund} hint={formatRM(refundable)} selected={choice === 'full'} onPress={() => setChoice('full')} />
          <RadioRow label={s.partialRefund} hint={s.partialRefundHint} selected={choice === 'partial'} onPress={() => setChoice('partial')} />
          {choice === 'partial' ? (
            <MoneyField
              label={s.refundAmount}
              valueSen={partialSen}
              onChangeSen={setPartialSen}
              error={partialInvalid && partialSen !== 0 ? s.refundTooLarge(formatRM(refundable)) : undefined}
            />
          ) : null}
          {choice !== 'keep' ? (
            <View className="gap-2 pt-2">
              <Text className="text-[13px] font-bold text-label">{s.refundMethod}</Text>
              <View className="flex-row flex-wrap gap-2">
                {REFUND_METHODS.map((m) => (
                  <Chip key={m} role="radio" label={s.refundMethods[m]} selected={method === m} onPress={() => setMethod(m)} />
                ))}
              </View>
              <Text className="text-[12px] text-muted">{s.refundNote}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {b.customer.phone ? <SwitchRow label={s.tellCustomer} hint={s.tellCustomerHint} value={tell} onChange={setTell} /> : null}

      <Button
        title={s.cancelConfirm}
        loading={busy}
        disabled={partialInvalid}
        onPress={() => onConfirm(finalReason, amountSen > 0 ? { amountSen, method } : undefined, tell)}
      />
      <Button title={s.keep} variant="secondary" onPress={onClose} />
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

function Note({ label, text }: { label: string; text: string }) {
  return (
    <View className="gap-0.5">
      <Text className="text-[12px] font-bold text-label">{label}</Text>
      <Text className="text-[14px]">{text}</Text>
    </View>
  );
}

function MapLink({ label, url }: { label: string; url: string }) {
  return (
    <Pressable onPress={() => void Linking.openURL(url)} accessibilityRole="link" className="min-h-[44px] flex-row items-center gap-1.5">
      <Icon name="pin" size={16} color={colors.primary} />
      <Text className="text-[13px] font-bold text-primary">{label}</Text>
    </Pressable>
  );
}

function RoundButton({ icon, label, onPress, primary }: { icon: IconName; label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`h-11 w-11 items-center justify-center rounded-button border ${
        primary ? 'border-primary bg-primary active:bg-primary-pressed' : 'border-border bg-card active:bg-pressed'
      }`}
    >
      <Icon name={icon} size={20} color={primary ? '#FFFFFF' : colors.text} />
    </Pressable>
  );
}

function SmallButton({ label, onPress, danger, disabled }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={`h-[46px] flex-1 items-center justify-center rounded-button border border-input-border bg-card px-2 active:bg-pressed ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <Text className={`text-[14px] font-semibold ${danger ? 'text-danger' : ''}`} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
