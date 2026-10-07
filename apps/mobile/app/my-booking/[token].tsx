import { Linking, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { formatInTimeZone } from 'date-fns-tz';
import type { BookingStatus, PublicBookingConfirmation } from '@outletbooking/shared';
import { Brand } from '@/components/Brand';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { formatTimeSpan, mapsUrl, whatsappUrl } from '@/features/bookings/format';
import { calendarFileUrl } from '@/features/public/api';
import { PublicPage, SummaryRow } from '@/features/public/components/PublicPage';
import { useCancelPublicBooking, usePublicBooking } from '@/features/public/hooks';
import { ApiError } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { formatRM } from '@/lib/format';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const b = t.book;

const badge: Record<BookingStatus, { icon: IconName; bg: string; fg: string }> = {
  confirmed: { icon: 'check', bg: 'bg-primary', fg: '#FFFFFF' },
  checked_in: { icon: 'check', bg: 'bg-primary', fg: '#FFFFFF' },
  completed: { icon: 'check', bg: 'bg-primary', fg: '#FFFFFF' },
  pending: { icon: 'clock', bg: 'bg-pend-bg', fg: colors['pend-fg'] },
  cancelled: { icon: 'x', bg: 'bg-neutral-bg', fg: colors['neutral-fg'] },
  no_show: { icon: 'x', bg: 'bg-neutral-bg', fg: colors['neutral-fg'] },
};

/** Short reference customers can quote to the business. */
const bookingRef = (token: string) => token.slice(0, 6).toUpperCase();

/** "20261010T120000Z" for Google Calendar links. */
const gcalTime = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * Customer's booking page (FR-08.4/08.5, wireframe C4): opened right after booking and later from
 * the saved link. Summary, add to calendar, WhatsApp the business, directions and the cancel link.
 */
export default function MyBookingPage() {
  const { token = '' } = useLocalSearchParams<{ token: string }>();
  const { data, isPending, error, refetch } = usePublicBooking(token);

  if (isPending) return <LoadingState />;
  if (error) {
    const notFound = error instanceof ApiError && [400, 404].includes(error.status);
    if (!notFound) return <ErrorState error={error} onRetry={() => void refetch()} />;
    return (
      <PublicPage>
        <Brand />
        <Card className="p-5">
          <Text className="text-[15px]">{b.bookingNotFound}</Text>
        </Card>
      </PublicPage>
    );
  }
  return (
    <>
      <Head>
        <title>{`${b.titles[data.status]} · ${data.business.name}`}</title>
      </Head>
      <BookingSummary booking={data} />
    </>
  );
}

function BookingSummary({ booking }: { booking: PublicBookingConfirmation }) {
  const cancel = useCancelPublicBooking(booking.token);
  const tz = booking.business.timezone;
  const biz = booking.business;
  const ref = bookingRef(booking.token);
  const when = `${formatInTimeZone(new Date(booking.startAt), tz, 'EEE, d MMM')} · ${formatTimeSpan(booking.startAt, booking.endAt, tz)}`;
  const active = booking.status === 'pending' || booking.status === 'confirmed';
  const place = booking.locationAddress ?? biz.address;
  const { icon, bg, fg } = badge[booking.status];

  const onCancel = async () => {
    if (await confirm(b.cancelTitle, b.cancelBody, b.cancelConfirm)) cancel.mutate();
  };

  const gcal =
    'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    `&text=${encodeURIComponent(`${booking.serviceName} · ${biz.name}`)}` +
    `&dates=${gcalTime(booking.startAt)}/${gcalTime(booking.endAt)}` +
    (place ? `&location=${encodeURIComponent(place)}` : '');

  return (
    <PublicPage>
      <View className="items-center gap-3 pt-4">
        <View className={`h-16 w-16 items-center justify-center rounded-full ${bg}`}>
          <Icon name={icon} size={32} color={fg} />
        </View>
        <Text className="text-center text-[24px] font-extrabold">{b.titles[booking.status]}</Text>
        {booking.status === 'pending' && booking.amountDueSen > 0 ? (
          <Text className="text-center text-[14px] text-muted">
            {b.pendingBody(
              formatRM(booking.amountDueSen),
              booking.expiresAt ? formatInTimeZone(new Date(booking.expiresAt), tz, 'h:mm a') : '—',
            )}
          </Text>
        ) : null}
        {active ? <Text className="text-center text-[13px] text-muted">{b.saveLink}</Text> : null}
      </View>

      <Card className="gap-2.5 p-4">
        <SummaryRow label={b.ref} value={ref} />
        <View className="h-px bg-border" />
        <SummaryRow label={b.where} value={`${biz.name} · ${booking.resourceName}`} />
        <SummaryRow label={b.when} value={when} />
        <SummaryRow label={t.booking.service} value={booking.serviceName} />
        {booking.locationAddress ? <SummaryRow label={b.address2} value={booking.locationAddress} /> : null}
        <SummaryRow label={b.price} value={booking.priceSen ? formatRM(booking.priceSen) : b.free} />
        {booking.paymentStatus === 'paid' ? (
          <SummaryRow label={b.paid} value={formatRM(booking.amountDueSen)} />
        ) : booking.paymentStatus === 'unpaid' && booking.amountDueSen > 0 && active ? (
          <SummaryRow label={b.toPay} value={formatRM(booking.amountDueSen)} strong />
        ) : null}
        {booking.customerName ? <SummaryRow label={b.name} value={booking.customerName} /> : null}
      </Card>

      <FormError message={cancel.error ? errorMessage(cancel.error) : null} />

      {booking.status !== 'cancelled' && booking.status !== 'no_show' ? (
        <View className="gap-2.5">
          {active ? (
            <>
              <Button variant="secondary" title={b.addToCalendar} onPress={() => void Linking.openURL(calendarFileUrl(booking.token))} />
              <Pressable onPress={() => void Linking.openURL(gcal)} accessibilityRole="link" className="min-h-[36px] items-center justify-center">
                <Text className="text-[14px] font-bold text-primary">{b.googleCalendar}</Text>
              </Pressable>
            </>
          ) : null}
          {biz.whatsappPhone ? (
            <Button
              variant="secondary"
              title={b.whatsappBusiness(biz.name)}
              onPress={() =>
                void Linking.openURL(`${whatsappUrl(biz.whatsappPhone!)}?text=${encodeURIComponent(b.whatsappMessage(ref, when))}`)
              }
            />
          ) : biz.phone ? (
            <Button variant="secondary" title={b.call} onPress={() => void Linking.openURL(`tel:${biz.phone}`)} />
          ) : null}
          {place ? <Button variant="secondary" title={b.directions} onPress={() => void Linking.openURL(mapsUrl(place))} /> : null}
        </View>
      ) : null}

      <View className="items-center gap-1 pt-2">
        {booking.cancellableUntil ? (
          <>
            <Pressable
              onPress={() => void onCancel()}
              disabled={cancel.isPending}
              accessibilityRole="button"
              className="min-h-[44px] justify-center"
            >
              <Text className="text-[15px] font-bold text-danger">{cancel.isPending ? t.common.loading : b.cancel}</Text>
            </Pressable>
            <Text className="text-[13px] text-muted">
              {b.cancelUntil(formatInTimeZone(new Date(booking.cancellableUntil), tz, 'EEE, d MMM, h:mm a'))}
            </Text>
          </>
        ) : active ? (
          <Text className="text-center text-[13px] text-muted">{b.contactToChange}</Text>
        ) : null}
        <Pressable
          onPress={() => router.push({ pathname: '/book/[slug]', params: { slug: biz.slug } })}
          accessibilityRole="link"
          className="min-h-[44px] justify-center"
        >
          <Text className="text-[14px] font-bold text-primary">{b.bookAgain}</Text>
        </Pressable>
        <Text className="text-[12px] text-muted">{b.poweredBy}</Text>
      </View>
    </PublicPage>
  );
}
