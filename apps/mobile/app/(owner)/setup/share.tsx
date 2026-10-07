import { Linking, Share, View } from 'react-native';
import { router } from 'expo-router';
import { QrCode } from '@/components/QrCode';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { useUpdateChecklist } from '@/features/onboarding/hooks';
import { useBusiness } from '@/features/setup/hooks';
import { bookingUrl, bookingUrlLabel } from '@/lib/config';
import { t } from '@/strings/en';

const s = t.setup.share;

/** O7 · Share your booking link: QR, WhatsApp, QR poster, other apps. */
export default function ShareScreen() {
  const business = useBusiness();
  const checklist = useUpdateChecklist();
  if (business.isPending) return <LoadingState />;
  if (business.error) return <ErrorState error={business.error} onRetry={() => void business.refetch()} />;

  const biz = business.data;
  const link = bookingUrl(biz.slug);
  const message = s.message(biz.name, link);
  // D8 "Share your booking link" ticks once the owner has shared it somewhere.
  const shared = () => checklist.mutate({ linkShared: true });

  return (
    <StackScreen title={s.title} subtitle={biz.name}>
      <Card className="items-center gap-3 p-5">
        <QrCode value={link} size={220} />
        <Text className="text-[13px] text-muted">{s.scan}</Text>
        <Text className="text-center text-[15px] font-bold text-primary">{bookingUrlLabel(biz.slug)}</Text>
      </Card>
      <View className="gap-2">
        <Button
          title={s.whatsapp}
          onPress={() => {
            void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`);
            shared();
          }}
        />
        <Button variant="secondary" title={s.poster} onPress={() => router.push('/setup/poster')} />
        <Button
          variant="secondary"
          title={s.more}
          onPress={async () => {
            const r = await Share.share({ message });
            if (r.action === Share.sharedAction) shared();
          }}
        />
        <Button variant="secondary" title={s.open} onPress={() => void Linking.openURL(link)} />
      </View>
      <Text className="text-[13px] text-muted">{s.tip}</Text>
    </StackScreen>
  );
}
