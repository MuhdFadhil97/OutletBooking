import { useState, type ReactNode } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { Booking, BookingStatus } from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Sheet } from '@/components/ui/Sheet';
import { Tag } from '@/components/ui/Tag';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { formatPhone, formatWhen, mapsUrl, statusTone, wazeUrl, whatsappUrl } from '@/features/bookings/format';
import { useBooking, useSetBookingStatus } from '@/features/bookings/hooks';
import { openBookingForm, type BookingsTab } from '@/features/bookings/nav';
import { useBookingFields, useBusiness, useServices } from '@/features/setup/hooks';
import { confirm } from '@/lib/confirm';
import { formatRM } from '@/lib/format';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.booking;

/** O4 · Booking detail: customer, appointment, answers, payment, status actions. */
export function BookingDetailScreen({ tab }: { tab: BookingsTab }) {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const booking = useBooking(id);
  const business = useBusiness();
  const services = useServices();
  const fields = useBookingFields();
  const setStatus = useSetBookingStatus(id);
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
  const phone = b.customer.phone;
  const tz = business.data.timezone;
  const service = services.data?.find((x) => x.id === b.service.id);
  const atCustomer = service?.locationType === 'at_customer_location' || !!b.locationAddress;
  const labels = new Map((fields.data ?? []).map((f) => [f.fieldKey, f.label]));
  const answers = Object.entries(b.customFields).filter(([, v]) => v !== '');

  const change = (status: BookingStatus, reason?: string | null) =>
    setStatus.mutate({ status, reason }, { onSuccess: () => setCancelling(false) });
  const onNoShow = async () => {
    if (await confirm(s.noShowTitle, s.noShowBody, s.noShow)) change('no_show');
  };
  const reschedule = () => openBookingForm(tab, { bookingId: String(b.id) });

  return (
    <StackScreen
      title={b.service.name}
      subtitle={`${b.resource.name} · ${s.source[b.source]}`}
      right={<Tag label={s.status[b.status]} tone={statusTone[b.status]} />}
    >
      <FormError message={setStatus.error ? errorMessage(setStatus.error) : null} />

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
        {/* No phone once the customer has been anonymised (PDPA erase). */}
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

      <Actions
        status={b.status}
        busy={setStatus.isPending}
        onChange={change}
        onNoShow={() => void onNoShow()}
        onCancel={() => setCancelling(true)}
        onReschedule={reschedule}
      />

      <CancelSheet
        visible={cancelling}
        busy={setStatus.isPending}
        onClose={() => setCancelling(false)}
        onConfirm={(reason) => change('cancelled', reason)}
      />
    </StackScreen>
  );
}

function PaymentSection({ b }: { b: Booking }) {
  if (b.priceSen === 0) {
    return (
      <Section title={s.payment}>
        <Row label={s.total} value={s.free} />
      </Section>
    );
  }
  const paidOnline = b.paymentStatus === 'paid' ? b.amountDueSen : 0;
  const mode = b.amountDueSen >= b.priceSen ? 'full' : 'deposit';
  return (
    <Section title={s.payment}>
      <Row label={s.total} value={formatRM(b.priceSen)} />
      {b.amountDueSen > 0 ? (
        <Row
          label={`${s.dueOnline(mode)} · ${s.paymentStatus[b.paymentStatus]}`}
          value={formatRM(b.amountDueSen)}
          tone={b.paymentStatus === 'paid' ? 'ok' : undefined}
        />
      ) : null}
      <Row label={s.balance} value={formatRM(b.priceSen - paidOnline)} />
    </Section>
  );
}

/** Primary action first (wireframe: Check in), then Reschedule · No-show · Cancel. */
function Actions({
  status,
  busy,
  onChange,
  onNoShow,
  onCancel,
  onReschedule,
}: {
  status: BookingStatus;
  busy: boolean;
  onChange: (s: BookingStatus) => void;
  onNoShow: () => void;
  onCancel: () => void;
  onReschedule: () => void;
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
      <Button title={p.label} loading={busy} onPress={() => onChange(p.to)} />
      {open ? (
        <View className="flex-row gap-2">
          <SmallButton label={t.booking.rescheduleTitle} onPress={onReschedule} />
          {status === 'confirmed' ? <SmallButton label={s.noShow} onPress={onNoShow} /> : null}
          <SmallButton label={s.cancel} danger onPress={onCancel} />
        </View>
      ) : null}
    </View>
  );
}

function CancelSheet({
  visible,
  busy,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string | null) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Sheet visible={visible} title={s.cancelTitle} onClose={onClose}>
      <TextField compact label={s.cancelReason} hint={s.cancelReasonHint} value={reason} onChangeText={setReason} maxLength={300} />
      <Button title={s.cancelConfirm} loading={busy} onPress={() => onConfirm(reason.trim() || null)} />
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

function SmallButton({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="h-[46px] flex-1 items-center justify-center rounded-button border border-input-border bg-card px-2 active:bg-pressed"
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
