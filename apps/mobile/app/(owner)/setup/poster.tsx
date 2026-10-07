import { Platform, View } from 'react-native';
import { QrCode } from '@/components/QrCode';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { useBusiness } from '@/features/setup/hooks';
import { bookingUrl, bookingUrlLabel } from '@/lib/config';
import { t } from '@/strings/en';

const s = t.setup.share;

/** O7 · QR poster for the counter: print on web, screenshot on a phone. */
export default function PosterScreen() {
  const business = useBusiness();
  if (business.isPending) return <LoadingState />;
  if (business.error) return <ErrorState error={business.error} onRetry={() => void business.refetch()} />;
  const biz = business.data;
  const web = Platform.OS === 'web';
  return (
    <StackScreen
      title={s.poster}
      footer={web ? <Button title={s.print} onPress={() => (globalThis as { print?: () => void }).print?.()} /> : undefined}
    >
      <View className="items-center gap-4 rounded-card border-2 border-primary bg-card px-6 py-8">
        <Text className="text-center text-[26px] font-extrabold">{biz.name}</Text>
        <Text className="text-[18px] font-bold text-primary">{s.posterTitle}</Text>
        <QrCode value={bookingUrl(biz.slug)} size={260} />
        <Text className="text-[14px] text-muted">{s.posterSub}</Text>
        <Text className="text-center text-[15px] font-bold">{bookingUrlLabel(biz.slug)}</Text>
      </View>
      {web ? null : <Text className="text-center text-[13px] text-muted">{s.posterHint}</Text>}
    </StackScreen>
  );
}
