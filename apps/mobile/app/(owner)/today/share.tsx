import { useEffect, useState } from 'react';
import { Linking, Pressable, Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { QrCode } from '@/components/ui/QrCode';
import { ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { useUpdateChecklist } from '@/features/onboarding/hooks';
import { useBusiness } from '@/features/setup/hooks';
import { PUBLIC_BOOKING_BASE, bookingUrl, bookingUrlLabel } from '@/lib/config';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.share;

/** O7 · Share booking link & QR (FR-02.3): copy, WhatsApp, printable QR poster, other apps. */
export default function ShareScreen() {
  const business = useBusiness();
  const [copied, setCopied] = useState(false);
  const updateChecklist = useUpdateChecklist();

  // D8: "Share your booking link" counts as done once the owner opens this screen.
  useEffect(() => {
    updateChecklist.mutate({ linkShared: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  if (!business.data) {
    return (
      <StackScreen title={s.title}>
        {business.error ? <ErrorState error={business.error} onRetry={() => void business.refetch()} /> : <LoadingState />}
      </StackScreen>
    );
  }

  const biz = business.data;
  const link = bookingUrl(biz.slug);
  const message = t.today.shareMessage(biz.name, link);
  const copy = async () => {
    await Clipboard.setStringAsync(link);
    setCopied(true);
  };

  return (
    <StackScreen title={s.title}>
      {!biz.bookingEnabled ? (
        <View className="flex-row items-center gap-2 rounded-card bg-pend-bg px-3.5 py-3">
          <Icon name="pause" size={18} color={colors['pend-fg']} />
          <Text className="flex-1 text-[14px] font-bold text-pend-fg">{s.bookingOff}</Text>
        </View>
      ) : null}

      <Card className="items-center gap-4 p-5">
        <Text className="text-[18px] font-extrabold">{biz.name}</Text>
        <QrCode value={link} size={200} label={s.qrLabel(biz.name)} />
        <View className="w-full flex-row items-center gap-2 rounded-input border border-input-border bg-bg pl-3.5">
          <Text className="flex-1 text-[14px] font-semibold" numberOfLines={1} selectable>
            {bookingUrlLabel(biz.slug)}
          </Text>
          <Pressable
            onPress={() => void copy()}
            accessibilityRole="button"
            accessibilityLabel={s.copy}
            className="h-11 flex-row items-center gap-1.5 px-3 active:bg-pressed"
          >
            {copied ? <Text className="text-[13px] font-bold text-primary">{s.copied}</Text> : null}
            <Icon name={copied ? 'check' : 'copy'} size={20} color={colors.primary} />
          </Pressable>
        </View>
      </Card>

      <Button title={s.whatsapp} onPress={() => void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`)} />
      <View className="flex-row gap-2.5">
        <View className="flex-1">
          <Button variant="secondary" title={s.poster} onPress={() => void Linking.openURL(`${PUBLIC_BOOKING_BASE}/book/${biz.slug}/poster`)} />
        </View>
        <View className="flex-1">
          <Button variant="secondary" title={s.more} onPress={() => void Share.share({ message })} />
        </View>
      </View>
      <Text className="text-[13px] text-muted">{s.tip}</Text>
    </StackScreen>
  );
}
