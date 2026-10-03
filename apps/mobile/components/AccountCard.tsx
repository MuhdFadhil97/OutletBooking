import { router } from 'expo-router';
import { View } from 'react-native';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Text } from './ui/Text';
import { useLogout } from '@/features/auth/hooks';
import { useMe } from '@/features/me/hooks';
import { bookingUrlLabel } from '@/lib/config';
import { t } from '@/strings/en';

/** Who is logged in + log out (Setup tab for owners, Profile tab for staff). */
export function AccountCard() {
  const { me } = useMe();
  const logout = useLogout();
  if (!me) return null;
  return (
    <Card className="gap-3 p-4">
      <View className="gap-0.5">
        <Text className="text-[16px] font-bold">{me.user.name}</Text>
        <Text className="text-[14px] text-muted">{me.user.email}</Text>
      </View>
      <View className="gap-0.5">
        <Text className="text-[14px] font-semibold">{me.business.name}</Text>
        <Text className="text-[13px] text-muted">{bookingUrlLabel(me.business.slug)}</Text>
      </View>
      <Button
        variant="secondary"
        title={t.common.logout}
        loading={logout.isPending}
        onPress={() => logout.mutate(undefined, { onSettled: () => router.replace('/login') })}
      />
    </Card>
  );
}
