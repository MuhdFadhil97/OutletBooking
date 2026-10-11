import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { formatInTimeZone } from 'date-fns-tz';
import type { Booking } from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Tag } from '@/components/ui/Tag';
import { Text } from '@/components/ui/Text';
import { showToast } from '@/components/ui/Toast';
import { formatPhone, formatTimeSpan, statusTone, whatsappUrl } from '@/features/bookings/format';
import { openBooking, openBookingForm } from '@/features/bookings/nav';
import { CustomerAvatar, CustomerTagView } from '@/features/customers/components/CustomerBits';
import { CustomerSheet } from '@/features/customers/components/CustomerSheet';
import { useCustomer, useEraseCustomer } from '@/features/customers/hooks';
import { useBusiness } from '@/features/setup/hooks';
import { confirm } from '@/lib/confirm';
import { formatRM } from '@/lib/format';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.customers;

/** D11 · Customer profile: call / WhatsApp / book, stats, notes, upcoming + history, PDPA erase. */
export default function CustomerScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const customer = useCustomer(id);
  const business = useBusiness();
  const erase = useEraseCustomer(id);
  const [editing, setEditing] = useState(false);

  if (!customer.data || !business.data) {
    const error = customer.error ?? business.error;
    return (
      <StackScreen title={s.profileTitle} backHref="/bookings/customers">
        {error ? <ErrorState error={error} onRetry={() => void customer.refetch()} /> : <LoadingState />}
      </StackScreen>
    );
  }

  const c = customer.data;
  const tz = business.data.timezone;
  const phone = c.phone;

  const onErase = async () => {
    if (!(await confirm(s.eraseTitle, s.eraseBody(c.name), s.eraseConfirm))) return;
    erase.mutate(undefined, {
      onSuccess: () => {
        showToast({ message: s.erased });
        if (router.canGoBack()) router.back();
        else router.replace('/bookings/customers');
      },
    });
  };

  return (
    <StackScreen title={s.profileTitle} backHref="/bookings/customers">
      <View className="flex-row items-center gap-3.5">
        <CustomerAvatar name={c.name} tag={c.tag} size={60} />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-[20px] font-extrabold">{c.name}</Text>
          <Text className="text-[14px] text-muted">{phone ? formatPhone(phone) : s.noPhone}</Text>
          {c.email ? <Text className="text-[13px] text-muted">{c.email}</Text> : null}
          <View className="flex-row pt-1">
            <CustomerTagView c={c} />
          </View>
        </View>
      </View>

      <View className="flex-row gap-2">
        <ActionButton icon="phone" label={s.call} disabled={!phone} onPress={() => void Linking.openURL(`tel:${phone}`)} />
        <ActionButton icon="chat" label={s.whatsapp} disabled={!phone} onPress={() => phone && void Linking.openURL(whatsappUrl(phone))} />
        <ActionButton
          icon="plus"
          label={s.book}
          onPress={() => openBookingForm('bookings', { customerId: String(c.id) })}
        />
      </View>

      <View className="flex-row gap-2">
        <Stat value={String(c.visits)} label={s.statVisits} />
        <Stat value={formatRM(c.spentSen)} label={s.statSpent} />
        <Stat value={String(c.noShows)} label={s.statNoShows} />
      </View>

      <Card className="gap-1.5 px-3.5 py-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-[13px] font-bold text-label">{s.notes}</Text>
          <Pressable onPress={() => setEditing(true)} accessibilityRole="button" hitSlop={10} className="min-h-[32px] justify-center">
            <Text className="text-[13px] font-bold text-primary">{s.edit}</Text>
          </Pressable>
        </View>
        <Text className={`text-[14px] leading-5 ${c.notes ? '' : 'text-muted'}`}>{c.notes ?? s.noNotes}</Text>
      </Card>

      {c.upcoming.length ? <BookingGroup title={s.upcoming} list={c.upcoming} tz={tz} /> : null}
      {c.history.length ? (
        <BookingGroup title={s.history} list={c.history} tz={tz} />
      ) : (
        <Text className="text-center text-[13px] text-muted">{s.noHistory}</Text>
      )}

      <FormError message={erase.error ? errorMessage(erase.error) : null} />
      <Pressable
        onPress={() => void onErase()}
        disabled={erase.isPending}
        accessibilityRole="button"
        className="min-h-[44px] items-center justify-center px-2"
      >
        <Text className="text-center text-[13px] font-bold text-danger">{s.erase}</Text>
      </Pressable>

      <CustomerSheet visible={editing} customer={c} onClose={() => setEditing(false)} />
    </StackScreen>
  );
}

function BookingGroup({ title, list, tz }: { title: string; list: Booking[]; tz: string }) {
  return (
    <View className="gap-2">
      <Text className="pt-1 text-[12px] font-extrabold uppercase tracking-[0.6px] text-muted">{title}</Text>
      <Card className="overflow-hidden">
        {list.map((b, i) => (
          <Pressable
            key={b.id}
            onPress={() => openBooking('bookings', b.id)}
            accessibilityRole="button"
            className={`min-h-[56px] flex-row items-center gap-3 px-3.5 py-3 active:bg-pressed ${i < list.length - 1 ? 'border-b border-border' : ''}`}
          >
            <View className="min-w-0 flex-1">
              <Text className="text-[14px] font-bold">
                {formatInTimeZone(new Date(b.startAt), tz, 'EEE, d MMM')} · {formatTimeSpan(b.startAt, b.endAt, tz)}
              </Text>
              <Text className="text-[12px] text-muted" numberOfLines={1}>
                {b.service.name} · {b.resource.name}
              </Text>
            </View>
            <View className="items-end gap-1">
              <BookingTag b={b} />
              {b.priceSen > 0 ? <Text className="text-[12px] font-bold">{formatRM(b.priceSen)}</Text> : null}
            </View>
          </Pressable>
        ))}
      </Card>
    </View>
  );
}

/** Upcoming: payment state; past: what happened. */
function BookingTag({ b }: { b: Booking }) {
  if (b.status === 'no_show') return <Tag label={t.booking.status.no_show} tone="danger" />;
  if ((b.status === 'confirmed' || b.status === 'pending') && Date.parse(b.endAt) >= Date.now()) {
    if (b.paymentStatus === 'paid') return <Tag label={t.booking.paymentStatus.paid} tone="ok" />;
    if (b.paymentStatus === 'unpaid') return <Tag label={t.booking.paymentStatus.unpaid} tone="pending" />;
  }
  return <Tag label={t.booking.status[b.status]} tone={b.status === 'confirmed' ? 'neutral' : statusTone[b.status]} />;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <Card className="flex-1 px-3 py-2.5">
      <Text className="text-[20px] font-extrabold" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text className="text-[12px] font-semibold text-muted">{label}</Text>
    </Card>
  );
}

function ActionButton({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={`h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-button border border-input-border bg-card active:bg-pressed ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <Icon name={icon} size={18} color={colors.primary} />
      <Text className="text-[13px] font-bold">{label}</Text>
    </Pressable>
  );
}
