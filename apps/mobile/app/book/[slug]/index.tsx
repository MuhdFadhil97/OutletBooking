import { Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import type { PublicService } from '@outletbooking/shared';
import { Brand } from '@/components/Brand';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { usePublicBusiness } from '@/features/public/hooks';
import { ApiError } from '@/lib/api';
import { formatDuration, formatRM } from '@/lib/format';
import { t } from '@/strings/en';

const b = t.book;

/**
 * Public booking page opened from the owner's shared link (no login).
 * For now it shows the business and its services; the slot picker and checkout arrive in Phase 4.
 */
export default function BookingPage() {
  const { slug = '' } = useLocalSearchParams<{ slug: string }>();
  const { data: biz, isPending, error, refetch } = usePublicBusiness(slug);

  if (isPending) return <LoadingState label={b.loading} />;
  if (error) {
    const notFound = error instanceof ApiError && [400, 404].includes(error.status);
    if (!notFound) return <ErrorState error={error} onRetry={() => void refetch()} />;
    return (
      <SafeAreaView className="flex-1 justify-center gap-5 bg-bg px-5">
        <Brand />
        <Card className="p-5">
          <Text className="text-[15px]">{b.notFound}</Text>
        </Card>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="mx-auto w-full max-w-[560px] gap-4 px-4 pb-8 pt-3">
        <Brand />
        <View className="gap-1">
          <Text className="text-[24px] font-extrabold">{biz.name}</Text>
          {biz.description ? <Text className="text-[15px] text-muted">{biz.description}</Text> : null}
          {biz.address ? <Text className="text-[14px] text-muted">{biz.address}</Text> : null}
        </View>

        <Card className="gap-3 p-4">
          <Text className="text-[14px]">{biz.bookingEnabled ? b.comingSoon : b.paused}</Text>
          {biz.whatsappPhone ? (
            <Button title={b.whatsapp} onPress={() => void Linking.openURL(`https://wa.me/${biz.whatsappPhone!.replace(/^\+/, '')}`)} />
          ) : null}
          {biz.phone && biz.phone !== biz.whatsappPhone ? (
            <Button
              variant={biz.whatsappPhone ? 'secondary' : 'primary'}
              title={b.call}
              onPress={() => void Linking.openURL(`tel:${biz.phone}`)}
            />
          ) : null}
        </Card>

        <Text className="text-[13px] font-bold uppercase text-muted">{b.services}</Text>
        {biz.services.length === 0 ? (
          <EmptyState title={b.noServices} />
        ) : (
          biz.services.map((svc) => <ServiceRow key={svc.id} svc={svc} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ServiceRow({ svc }: { svc: PublicService }) {
  const durations = svc.durationOptions?.length ? svc.durationOptions.map(formatDuration).join(' / ') : formatDuration(svc.durationMin);
  const price = svc.priceSen
    ? `${formatRM(svc.priceSen)}${svc.priceUnit === 'per_block' ? t.setup.services.perBlockShort : ''}`
    : b.free;
  const extras = [
    svc.depositSen && !svc.prepayFull ? b.deposit(formatRM(svc.depositSen)) : null,
    svc.locationType === 'at_customer_location' ? b.atYourPlace : null,
  ].filter(Boolean);

  return (
    <Card className="gap-1 p-4">
      <View className="flex-row items-start justify-between gap-3">
        <Text className="flex-1 text-[16px] font-bold">{svc.name}</Text>
        <Text className="text-[15px] font-bold">{price}</Text>
      </View>
      <Text className="text-[13px] text-muted">{[durations, ...extras].join(' · ')}</Text>
      {svc.description ? <Text className="text-[14px] text-muted">{svc.description}</Text> : null}
    </Card>
  );
}
