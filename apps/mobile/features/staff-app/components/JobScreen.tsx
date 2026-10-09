import { useEffect, useState, type ReactNode } from 'react';
import { Image, Linking, Platform, Pressable, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { formatInTimeZone } from 'date-fns-tz';
import { ATTACHMENTS_PER_BOOKING, type Booking, type BookingAttachment, type BookingStatus } from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Sheet } from '@/components/ui/Sheet';
import { Tag } from '@/components/ui/Tag';
import { Text } from '@/components/ui/Text';
import { showToast } from '@/components/ui/Toast';
import { formatPhone, mapsUrl, statusTone, wazeUrl, whatsappUrl } from '@/features/bookings/format';
import { useBooking, useBookingEvents, useSetBookingStatus } from '@/features/bookings/hooks';
import { useMe } from '@/features/me/hooks';
import { PaymentActions, balanceDue } from '@/features/payments/components/PaymentActions';
import { useBookingFields, useBusiness } from '@/features/setup/hooks';
import { confirm } from '@/lib/confirm';
import { formatRM } from '@/lib/format';
import { useIsOffline } from '@/lib/network';
import { t } from '@/strings/en';
import { colors } from '@/theme';
import type { PickedPhoto } from '../api';
import { firstAnswer } from '../format';
import { useDeletePhoto, usePhotos, useSetResultNotes, useUploadPhoto } from '../hooks';

const s = t.staffApp;
const NOTES_STATUSES: BookingStatus[] = ['confirmed', 'checked_in', 'completed'];

/** S2 · Job in progress: customer, directions, answers, result notes, photos, collect balance, check in / complete. */
export function JobScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const booking = useBooking(id);
  const events = useBookingEvents(id);
  const business = useBusiness();
  const fields = useBookingFields();
  const setStatus = useSetBookingStatus(id);
  const offline = useIsOffline();
  const { me } = useMe();

  if (!booking.data || !business.data) {
    const error = booking.error ?? business.error;
    return (
      <StackScreen title={t.booking.appointment} backHref="/staff/today">
        {error ? <ErrorState error={error} onRetry={() => void booking.refetch()} /> : <LoadingState />}
      </StackScreen>
    );
  }

  const b = booking.data;
  const tz = business.data.timezone;
  const labels = new Map((fields.data ?? []).map((f) => [f.fieldKey, f.label]));
  const answers = Object.entries(b.customFields).filter(([, v]) => v !== '');
  const phone = b.customer.phone;
  const when = b.checkedInAt
    ? s.checkedInAt(formatInTimeZone(new Date(b.checkedInAt), tz, 'h:mm a'))
    : formatInTimeZone(new Date(b.startAt), tz, 'EEE d MMM, h:mm a');

  const change = (status: BookingStatus, toast: string) =>
    setStatus.mutate({ status }, { onSuccess: () => showToast({ message: toast }) });
  const onNoShow = async () => {
    if (await confirm(t.booking.noShowTitle, t.booking.noShowBody, t.booking.noShow)) change('no_show', t.booking.status.no_show);
  };

  const footer =
    b.status === 'confirmed' ? (
      <View className="gap-2">
        <Button title={s.checkInArrived} loading={setStatus.isPending} disabled={offline} onPress={() => change('checked_in', s.checkedInToast)} />
        <Button title={s.noShow} variant="secondary" disabled={offline || setStatus.isPending} onPress={() => void onNoShow()} />
      </View>
    ) : b.status === 'checked_in' ? (
      <Button title={s.markCompleted} loading={setStatus.isPending} disabled={offline} onPress={() => change('completed', s.completedToast)} />
    ) : undefined;

  return (
    <StackScreen
      title={firstAnswer(b) ?? b.service.name}
      subtitle={firstAnswer(b) ? `${b.service.name} · ${when}` : when}
      right={<Tag label={b.status === 'checked_in' ? s.inProgress : t.booking.status[b.status]} tone={statusTone[b.status]} />}
      footer={footer}
      backHref="/staff/today"
    >
      <FormError message={setStatus.error ? errorMessage(setStatus.error) : null} />

      <Card className="flex-row items-center gap-3 px-3.5 py-3">
        <View className="flex-1">
          <Text className="text-[14px] font-extrabold">{b.customer.name}</Text>
          <Text className="text-[12px] text-muted">{phone ? formatPhone(phone) : s.noPhone}</Text>
        </View>
        {phone ? (
          <Pressable
            onPress={() => void Linking.openURL(whatsappUrl(phone))}
            accessibilityRole="link"
            accessibilityLabel={s.whatsapp}
            className="h-11 w-11 items-center justify-center rounded-button border border-border bg-card active:bg-pressed"
          >
            <Icon name="chat" size={20} color={colors.primary} />
          </Pressable>
        ) : null}
      </Card>

      {b.locationAddress ? (
        <Section title={s.location}>
          <Text className="text-[14px] font-semibold">{b.locationAddress}</Text>
          <View className="flex-row gap-2">
            <OutlineLink label={s.waze} url={wazeUrl(b.locationAddress)} />
            <OutlineLink label={s.maps} url={mapsUrl(b.locationAddress)} />
          </View>
        </Section>
      ) : null}

      {answers.length || b.customerNotes ? (
        <Section title={s.details}>
          {answers.map(([k, v]) => (
            <View key={k} className="flex-row justify-between gap-3">
              <Text className="flex-shrink text-[14px] text-muted">{labels.get(k) ?? k}</Text>
              <Text className="flex-1 text-right text-[14px] font-bold">{String(v)}</Text>
            </View>
          ))}
          {b.customerNotes ? <Text className="text-[14px]">{b.customerNotes}</Text> : null}
        </Section>
      ) : null}

      {NOTES_STATUSES.includes(b.status) ? <ResultNotes booking={b} disabled={offline} /> : null}
      {b.status !== 'cancelled' && b.status !== 'no_show' ? (
        <Photos bookingId={b.id} myUserId={me?.user.id ?? 0} isOwner={me?.role === 'owner'} disabled={offline} />
      ) : null}

      <PaymentCard booking={b} />
      {me?.permissions.canTakePayments ? <PaymentActions booking={b} events={events.data} tz={tz} disabled={offline} /> : null}
    </StackScreen>
  );
}

function ResultNotes({ booking, disabled }: { booking: Booking; disabled: boolean }) {
  const save = useSetResultNotes(booking.id);
  const [text, setText] = useState(booking.resultNotes ?? '');
  useEffect(() => setText(booking.resultNotes ?? ''), [booking.resultNotes]);
  const dirty = text.trim() !== (booking.resultNotes ?? '');

  return (
    <View className="gap-1.5">
      <Text className="text-[13px] font-bold text-label">{s.resultNotes}</Text>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        maxLength={4000}
        accessibilityLabel={s.resultNotes}
        placeholder={s.resultNotesHint}
        placeholderTextColor={colors.muted}
        textAlignVertical="top"
        className="min-h-[96px] rounded-input border border-input-border bg-card px-3 py-3 font-sans text-[14px] leading-5 text-text"
      />
      <FormError message={save.error ? errorMessage(save.error) : null} />
      {dirty ? (
        <Button
          variant="secondary"
          title={s.saveNotes}
          loading={save.isPending}
          disabled={disabled}
          onPress={() => save.mutate(text, { onSuccess: () => showToast({ message: s.notesSaved }) })}
        />
      ) : null}
    </View>
  );
}

function Photos({ bookingId, myUserId, isOwner, disabled }: { bookingId: number; myUserId: number; isOwner: boolean; disabled: boolean }) {
  const photos = usePhotos(bookingId);
  const upload = useUploadPhoto(bookingId);
  const remove = useDeletePhoto(bookingId);
  const [choosing, setChoosing] = useState(false);
  const [denied, setDenied] = useState(false);
  const list = photos.data ?? [];
  const full = list.length >= ATTACHMENTS_PER_BOOKING;

  const pick = async (from: 'camera' | 'library') => {
    setChoosing(false);
    setDenied(false);
    if (from === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return setDenied(true);
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: 'images', quality: 0.6 };
    const result = from === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    const photo: PickedPhoto = {
      uri: asset.uri,
      mimeType: asset.mimeType ?? 'image/jpeg',
      fileName: asset.fileName ?? `photo-${Date.now()}.jpg`,
    };
    upload.mutate(photo, { onSuccess: () => showToast({ message: s.photoAdded }) });
  };
  // Expo web has no camera picker: go straight to choosing a file.
  const onAdd = () => (Platform.OS === 'web' ? void pick('library') : setChoosing(true));

  const onDelete = async (p: BookingAttachment) => {
    if (await confirm(s.deletePhotoTitle, s.deletePhotoBody, s.deletePhoto)) remove.mutate(p.id);
  };

  return (
    <View className="gap-2">
      <View className="flex-row justify-between">
        <Text className="text-[13px] font-bold text-label">{s.photos(list.length)}</Text>
        <Text className="text-[12px] text-muted">{s.photosHint}</Text>
      </View>
      {photos.error ? <ErrorState error={photos.error} onRetry={() => void photos.refetch()} /> : null}
      <FormError message={upload.error ? errorMessage(upload.error) : remove.error ? errorMessage(remove.error) : denied ? s.cameraDenied : null} />
      <View className="flex-row flex-wrap gap-2">
        {list.map((p) => {
          const mine = isOwner || p.uploadedBy?.id === myUserId;
          return (
            <View
              key={p.id}
              accessibilityLabel={p.uploadedBy?.name}
              className="aspect-square w-[23%] overflow-hidden rounded-[10px] bg-neutral-bg"
            >
              <Image source={{ uri: p.url }} className="h-full w-full" resizeMode="cover" />
              {mine ? (
                <Pressable
                  onPress={() => void onDelete(p)}
                  accessibilityRole="button"
                  accessibilityLabel={s.deletePhoto}
                  hitSlop={8}
                  className="absolute right-1 top-1 h-6 w-6 items-center justify-center rounded-full bg-black/50"
                >
                  <Icon name="x" size={14} color="#FFFFFF" />
                </Pressable>
              ) : null}
            </View>
          );
        })}
        {!full ? (
          <Pressable
            onPress={onAdd}
            disabled={disabled || upload.isPending}
            accessibilityRole="button"
            accessibilityLabel={s.addPhoto}
            className={`aspect-square w-[23%] items-center justify-center rounded-[10px] border-2 border-dashed border-input-border active:bg-pressed ${
              disabled ? 'opacity-50' : ''
            }`}
          >
            {upload.isPending ? <Text className="text-[11px] font-bold text-muted">…</Text> : <Icon name="camera" size={24} color={colors.label} />}
          </Pressable>
        ) : null}
      </View>
      <Sheet visible={choosing} title={s.addPhoto} onClose={() => setChoosing(false)}>
        <Button title={s.takePhoto} onPress={() => void pick('camera')} />
        <Button title={s.choosePhoto} variant="secondary" onPress={() => void pick('library')} />
      </Sheet>
    </View>
  );
}

/** Wireframe payment card: total, paid so far, what is left to collect. */
function PaymentCard({ booking: b }: { booking: Booking }) {
  const toCollect = balanceDue(b);
  const tag =
    b.priceSen === 0
      ? { label: s.noPayment, tone: 'neutral' as const }
      : toCollect > 0
        ? { label: t.booking.balance, tone: 'pending' as const }
        : { label: s.paidInFull, tone: 'ok' as const };
  return (
    <Card className="gap-2 px-3.5 py-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-[14px] font-extrabold">{s.payment}</Text>
        <Tag label={tag.label} tone={tag.tone} />
      </View>
      {b.priceSen > 0 ? (
        <>
          <Line label={b.service.name} value={formatRM(b.priceSen)} />
          {b.paidSen > 0 ? <Line label={t.booking.paidSoFar} value={`− ${formatRM(b.paidSen)}`} ok /> : null}
          {b.refundedSen > 0 ? <Line label={t.booking.refunded} value={formatRM(b.refundedSen)} /> : null}
          <View className="flex-row justify-between">
            <Text className="text-[15px] font-extrabold">{s.toCollect}</Text>
            <Text className="text-[15px] font-extrabold">{formatRM(toCollect)}</Text>
          </View>
        </>
      ) : null}
    </Card>
  );
}

function Line({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <View className="flex-row justify-between gap-3">
      <Text className="flex-shrink text-[14px] text-muted">{label}</Text>
      <Text className={`text-[14px] font-bold ${ok ? 'text-ok-fg' : ''}`}>{value}</Text>
    </View>
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

function OutlineLink({ label, url }: { label: string; url: string }) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      accessibilityRole="link"
      className="h-11 flex-1 items-center justify-center rounded-button border border-input-border bg-card active:bg-pressed"
    >
      <Text className="text-[13px] font-bold">{label}</Text>
    </Pressable>
  );
}
