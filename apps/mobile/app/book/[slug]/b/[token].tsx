import { useEffect, useRef, type ReactNode } from 'react';
import { Linking, Platform, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { formatInTimeZone } from 'date-fns-tz';
import type { PublicBookingConfirmation } from '@outletbooking/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Tag } from '@/components/ui/Tag';
import { Text } from '@/components/ui/Text';
import { PageShell } from '@/features/public/components/PageShell';
import { calendarUrl, whenLine } from '@/features/public/format';
import { useCancelPublicBooking, usePayPublicBooking, usePublicBooking, useRefreshPublicBooking } from '@/features/public/hooks';
import { mapsUrl } from '@/features/bookings/format';
import { ApiError } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { formatRM } from '@/lib/format';
import { mmss, useCountdown } from '@/lib/use-countdown';
import { t } from '@/strings/en';

const b = t.book;

/**
 * The customer's own booking, by the random token in their link.
 * Right after booking (?new=1) it is the confirmation (C4 / C5c / C6c); later it is F5 view / cancel.
 */
export default function PublicBookingScreen() {
  // ToyyibPay sends the customer back here with ?status_id=…&billcode=…
  const { token = '', new: isNew, status_id: back, billcode } = useLocalSearchParams<{
    token: string;
    new?: string;
    status_id?: string;
    billcode?: string;
  }>();
  const booking = usePublicBooking(token);
  const refresh = useRefreshPublicBooking(token);
  const checked = useRef(false);
  useEffect(() => {
    if ((back || billcode) && !checked.current) {
      checked.current = true;
      refresh.mutate();
    }
  }, [back, billcode, refresh]);
  if (refresh.isPending) return <LoadingState label={b.checkingPayment} />;
  if (booking.isPending) return <LoadingState label={b.loading} />;
  if (booking.error) {
    const missing = booking.error instanceof ApiError && [400, 404].includes(booking.error.status);
    return missing ? (
      <View className="flex-1 justify-center bg-bg px-5">
        <Card className="p-5">
          <Text className="text-[15px]">{b.notFound}</Text>
        </Card>
      </View>
    ) : (
      <ErrorState error={booking.error} onRetry={() => void booking.refetch()} />
    );
  }
  return <BookingView bk={booking.data} fresh={isNew === '1'} />;
}

function BookingView({ bk, fresh }: { bk: PublicBookingConfirmation; fresh: boolean }) {
  const cancel = useCancelPublicBooking(bk.token);
  const tz = bk.business.timezone;
  const when = whenLine(bk.startAt, bk.endAt, tz);
  const wa = bk.business.whatsappPhone ?? bk.business.phone;
  const where = bk.locationAddress ?? bk.business.address;
  const open = bk.status === 'pending' || bk.status === 'confirmed';
  const paidSen = bk.paymentStatus === 'paid' ? bk.amountDueSen : 0;
  const payOnline = bk.payment.required && bk.payment.onlineAvailable;
  const toPaySen = Math.max(0, bk.priceSen - paidSen);

  const heading =
    bk.status === 'pending'
      ? b.bookedPending
      : bk.business.template === 'real_estate'
        ? b.bookedViewing
        : bk.business.template === 'vehicle_inspection'
          ? b.bookedInspection
          : b.booked;

  const onCancel = async () => {
    if (await confirm(b.cancelConfirmTitle, b.cancelConfirmBody, b.cancelBooking)) cancel.mutate();
  };

  return (
    <PageShell biz={{ ...bk.business }} compactHeader>
      {fresh && bk.status !== 'cancelled' ? (
        <View className="gap-1">
          <Text className="text-[24px] font-extrabold">{heading}</Text>
          <Text className="text-[14px] text-muted">{b.sentTo}</Text>
        </View>
      ) : (
        <View className="flex-row items-center justify-between">
          <Text className="text-[22px] font-extrabold">{b.yourBooking}</Text>
          <Tag label={b.status[bk.status]} tone={bk.status === 'confirmed' ? 'ok' : bk.status === 'pending' ? 'pending' : 'neutral'} />
        </View>
      )}

      {payOnline ? <PayCard bk={bk} /> : null}
      {fresh && bk.payment.status === 'paid' && bk.status === 'confirmed' ? (
        <Text className="text-[14px] font-bold text-ok-fg">{b.paidThanks}</Text>
      ) : null}

      <Card className="gap-2.5 p-4">
        <Row label={b.ref} value={bk.ref} strong />
        <Row label={b.where} value={[bk.serviceName, bk.resourceName].join(' · ')} />
        <Row label={b.when} value={when} />
        {bk.locationAddress ? <Row label={b.address} value={bk.locationAddress} /> : null}
        {bk.answers.map((a) => (
          <Row key={a.label} label={a.label} value={a.value} />
        ))}
        {bk.customerName ? <Row label={b.name} value={bk.customerName} /> : null}
        {bk.priceSen === 0 ? (
          <Row label={b.total} value={b.free} />
        ) : (
          <>
            {paidSen ? <Row label={b.paid} value={formatRM(paidSen)} /> : null}
            {bk.status === 'pending' && bk.amountDueSen ? <Row label={b.toPay} value={formatRM(bk.amountDueSen)} /> : null}
            {(bk.status === 'confirmed' || bk.status === 'checked_in') && toPaySen ? (
              <Row label={b.payLater} value={formatRM(toPaySen)} />
            ) : null}
          </>
        )}
      </Card>

      {open ? (
        <View className="gap-2">
          <Button
            variant="secondary"
            title={b.addToCalendar}
            onPress={() =>
              void Linking.openURL(
                calendarUrl({
                  title: `${bk.serviceName} · ${bk.business.name}`,
                  startIso: bk.startAt,
                  endIso: bk.endAt,
                  details: `${b.ref} ${bk.ref}`,
                  location: where,
                }),
              )
            }
          />
          {wa ? (
            <Button
              title={b.whatsappBusiness(bk.business.name)}
              onPress={() =>
                void Linking.openURL(
                  `https://wa.me/${wa.replace(/\D/g, '')}?text=${encodeURIComponent(`${b.ref} ${bk.ref} · ${bk.serviceName} · ${when}`)}`,
                )
              }
            />
          ) : null}
          {where ? <Button variant="secondary" title={b.directions} onPress={() => void Linking.openURL(mapsUrl(where))} /> : null}
        </View>
      ) : null}

      {bk.status === 'cancelled' ? (
        <Section>
          <Text className="text-[15px] font-bold">{b.cancelled}</Text>
          <Button variant="secondary" title={b.bookAgain} onPress={() => router.replace({ pathname: '/book/[slug]', params: { slug: bk.business.slug } })} />
        </Section>
      ) : open ? (
        <Section>
          <Text className="text-[15px] font-bold">{b.needCancel}</Text>
          <FormError message={cancel.error ? errorMessage(cancel.error) : null} />
          {bk.cancel.allowed && bk.cancel.until ? (
            <>
              <Text className="text-[13px] text-muted">{b.freeUntil(formatInTimeZone(new Date(bk.cancel.until), tz, 'EEE, d MMM, h:mm a'))}</Text>
              <Button variant="danger" title={b.cancelBooking} loading={cancel.isPending} onPress={() => void onCancel()} />
            </>
          ) : (
            <Text className="text-[13px] text-muted">{b.afterCutoff}</Text>
          )}
        </Section>
      ) : null}
    </PageShell>
  );
}

/** C4 pay step, or F4 when the bank did not confirm: hold countdown, pay / try again. */
function PayCard({ bk }: { bk: PublicBookingConfirmation }) {
  const pay = usePayPublicBooking(bk.token);
  const refresh = useRefreshPublicBooking(bk.token);
  const left = useCountdown(bk.expiresAt);
  const amount = formatRM(bk.payment.amountSen);
  const failed = bk.payment.status === 'failed';
  const wa = bk.business.whatsappPhone ?? bk.business.phone;

  const go = () =>
    pay.mutate(undefined, {
      onSuccess: ({ url }) => {
        if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.assign(url);
        else void Linking.openURL(url);
      },
    });

  if (left === 0) {
    return (
      <Card className="gap-3 p-4">
        <Text className="text-[15px] font-bold">{b.holdOver}</Text>
        <Button title={b.pickAnother} onPress={() => router.replace({ pathname: '/book/[slug]', params: { slug: bk.business.slug } })} />
      </Card>
    );
  }
  return (
    <Card className={`gap-3 p-4 ${failed ? 'border-danger' : ''}`}>
      {failed ? (
        <View className="gap-1">
          <Text className="text-[17px] font-extrabold text-danger">{b.payFailedTitle}</Text>
          <Text className="text-[14px] text-label">{b.payFailedBody}</Text>
        </View>
      ) : (
        <View className="gap-1">
          <Text className="text-[17px] font-extrabold">{b.payToConfirm(amount)}</Text>
          <Text className="text-[13px] text-muted">{b.payWithFpx}</Text>
        </View>
      )}
      {left !== null ? (
        <View className="self-start rounded-full bg-pend-bg px-3 py-1.5">
          <Text className="text-[13px] font-bold text-pend-fg">{b.heldFor(mmss(left))}</Text>
        </View>
      ) : null}
      <FormError message={pay.error ? errorMessage(pay.error) : refresh.error ? errorMessage(refresh.error) : null} />
      <Button title={failed ? b.tryAgain(amount) : b.payNow(amount)} loading={pay.isPending} onPress={go} />
      <Button variant="secondary" title={b.alreadyPaid} loading={refresh.isPending} onPress={() => refresh.mutate()} />
      {failed ? (
        <>
          {bk.payment.reference ? <Text className="text-[12px] text-muted">{b.payFailedHelp(bk.payment.reference)}</Text> : null}
          {wa ? (
            <Button
              variant="secondary"
              title={b.whatsappBusiness(bk.business.name)}
              onPress={() => void Linking.openURL(`https://wa.me/${wa.replace(/\D/g, '')}?text=${encodeURIComponent(`${b.ref} ${bk.ref}`)}`)}
            />
          ) : null}
          <Button variant="secondary" title={b.pickAnother} onPress={() => router.replace({ pathname: '/book/[slug]', params: { slug: bk.business.slug } })} />
        </>
      ) : null}
    </Card>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <Card className="gap-2 p-4">{children}</Card>;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View className="flex-row justify-between gap-3">
      <Text className="text-[14px] text-muted">{label}</Text>
      <Text className={`flex-1 text-right text-[14px] ${strong ? 'font-extrabold' : 'font-bold'}`}>{value}</Text>
    </View>
  );
}
