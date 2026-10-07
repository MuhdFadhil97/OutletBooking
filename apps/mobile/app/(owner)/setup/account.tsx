import { Linking, View } from 'react-native';
import { SUPPORT_WHATSAPP } from '@outletbooking/shared';
import { router } from 'expo-router';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ListRow, SectionLabel } from '@/components/ui/Rows';
import { ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/features/account/components/Avatar';
import { useLogout } from '@/features/auth/hooks';
import { useMe } from '@/features/me/hooks';
import { formatPhone, whatsappUrl } from '@/features/bookings/format';
import { t } from '@/strings/en';

const s = t.account;

/**
 * H6 · My account (opened from the Setup avatar): details, change password, app, help on WhatsApp,
 * log out, delete account (owner). Notification settings come with the Phase 4 notifications work.
 */
export default function AccountScreen() {
  const { me, isLoading, error, refetch } = useMe();
  const logout = useLogout();

  if (isLoading) return <LoadingState />;
  if (error || !me) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <StackScreen title={s.title}>
      <Card className="flex-row items-center gap-3 p-4">
        <Avatar name={me.user.name} size={52} />
        <View className="flex-1 gap-0.5">
          <Text className="text-[17px] font-extrabold" numberOfLines={1}>
            {me.user.name}
          </Text>
          <Text className="text-[13px] text-muted" numberOfLines={1}>
            {s.roleAt(s.role[me.role], me.business.name)}
          </Text>
        </View>
      </Card>

      <Card className="overflow-hidden">
        <ListRow title={s.email} subtitle={me.user.email} />
        <ListRow title={s.mobile} subtitle={me.user.phone ? formatPhone(me.user.phone) : s.noMobile} />
        <ListRow title={s.changePassword} onPress={() => router.push('/setup/password')} last />
      </Card>

      <SectionLabel label={s.app} />
      <Card className="overflow-hidden">
        <ListRow title={s.language} subtitle={s.english} />
        <ListRow
          title={s.help}
          subtitle={s.helpHint}
          onPress={() =>
            void Linking.openURL(
              `${whatsappUrl(SUPPORT_WHATSAPP)}?text=${encodeURIComponent(s.helpMessage(me.business.name))}`,
            )
          }
          last
        />
      </Card>

      <Button
        variant="secondary"
        title={s.logout}
        loading={logout.isPending}
        onPress={() => logout.mutate(undefined, { onSettled: () => router.replace('/login') })}
      />

      {me.role === 'owner' ? (
        <Button variant="secondary" title={s.deleteAccount} onPress={() => router.push('/setup/delete-account')} />
      ) : null}
    </StackScreen>
  );
}
