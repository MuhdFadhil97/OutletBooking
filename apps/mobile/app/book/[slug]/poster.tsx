import { useState } from 'react';
import { Platform, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { Button } from '@/components/ui/Button';
import { QrCode } from '@/components/ui/QrCode';
import { ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { PublicPage } from '@/features/public/components/PublicPage';
import { usePublicBusiness } from '@/features/public/hooks';
import { bookingUrl, bookingUrlLabel } from '@/lib/config';
import { t } from '@/strings/en';

const b = t.book;

/** Printable QR poster for the counter (FR-02.3). The owner opens it from Share → QR poster. */
export default function PosterPage() {
  const { slug = '' } = useLocalSearchParams<{ slug: string }>();
  const { data: biz, isPending, error, refetch } = usePublicBusiness(slug);
  const [printing, setPrinting] = useState(false);

  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const print = () => {
    // Hide the button while the print dialog captures the page.
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 50);
  };

  return (
    <PublicPage>
      <Head>
        <title>{`${b.scanToBook} · ${biz.name}`}</title>
      </Head>
      <View className="items-center gap-5 rounded-card border border-border bg-card px-6 py-10">
        <Text className="text-center text-[28px] font-extrabold">{biz.name}</Text>
        <Text className="text-center text-[22px] font-extrabold text-primary">{b.scanToBook}</Text>
        <QrCode value={bookingUrl(biz.slug)} size={280} label={t.share.qrLabel(biz.name)} />
        <Text className="text-center text-[16px] font-bold">{bookingUrlLabel(biz.slug)}</Text>
        <Text className="text-center text-[15px] text-muted">{b.posterBody}</Text>
        <Text className="text-[12px] text-muted">{b.poweredBy}</Text>
      </View>
      {Platform.OS === 'web' && !printing ? <Button title={b.print} onPress={print} /> : null}
    </PublicPage>
  );
}
