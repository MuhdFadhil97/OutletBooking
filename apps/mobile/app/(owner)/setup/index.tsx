import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ScreenTitle } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ListRow } from '@/components/ui/Rows';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/features/account/components/Avatar';
import { useMe } from '@/features/me/hooks';
import { useBookingFields, useBusiness, useResources, useServices } from '@/features/setup/hooks';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.setup.menu;

function RowIcon({ name }: { name: IconName }) {
  return (
    <View className="h-9 w-9 items-center justify-center rounded-input bg-soft">
      <Icon name={name} size={20} color={colors.primary} />
    </View>
  );
}

/** Setup menu: everything an owner configures before taking bookings. */
export default function SetupScreen() {
  const { me } = useMe();
  const business = useBusiness();
  const services = useServices();
  const resources = useResources();
  const fields = useBookingFields();

  const label = business.data?.resourceLabel ?? 'Resource';
  const refreshing = business.isRefetching || services.isRefetching || resources.isRefetching;
  const refresh = () => {
    void business.refetch();
    void services.refetch();
    void resources.refetch();
    void fields.refetch();
  };

  const rows: { title: string; subtitle?: string; icon: IconName; href: Parameters<typeof router.push>[0] }[] = [
    { title: s.profile, subtitle: s.profileSub, icon: 'building', href: '/setup/profile' },
    { title: t.setup.profile.rulesTitle, subtitle: t.setup.profile.rulesSub, icon: 'settings', href: '/setup/rules' },
    {
      title: s.services,
      subtitle: services.data ? s.servicesSub(services.data.length) : undefined,
      icon: 'tag',
      href: '/setup/services',
    },
    {
      title: s.resources(label),
      subtitle: resources.data ? s.resourcesSub(resources.data.length) : undefined,
      icon: 'calendar',
      href: '/setup/resources',
    },
    { title: s.timeOff, subtitle: s.timeOffSub, icon: 'pause', href: '/setup/time-off' },
    {
      title: s.fields,
      subtitle: fields.data ? s.fieldsSub(fields.data.filter((f) => f.isActive).length) : undefined,
      icon: 'form',
      href: '/setup/fields',
    },
    { title: s.staff, subtitle: s.staffSub, icon: 'users', href: '/setup/staff' },
  ];

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      <ScrollView
        contentContainerClassName="gap-4 px-4 pb-8 pt-3"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      >
        <View className="flex-row items-center justify-between">
          <ScreenTitle title={t.setup.title} subtitle={business.data?.name} />
          {me ? (
            <Pressable
              onPress={() => router.push('/setup/account')}
              accessibilityRole="button"
              accessibilityLabel={t.account.open}
              className="h-11 w-11 items-center justify-center rounded-full active:opacity-70"
            >
              <Avatar name={me.user.name} size={40} />
            </Pressable>
          ) : null}
        </View>

        {business.data && !business.data.bookingEnabled ? (
          <View className="flex-row items-center gap-2 rounded-card bg-pend-bg px-3.5 py-3">
            <Icon name="pause" size={18} color={colors['pend-fg']} />
            <Text className="text-[14px] font-bold text-pend-fg">{s.bookingOff}</Text>
          </View>
        ) : null}

        <Text className="text-[13px] font-bold text-label">{t.setup.yourBusiness}</Text>
        <Card className="overflow-hidden">
          {rows.map((r, i) => (
            <ListRow
              key={r.title}
              title={r.title}
              subtitle={r.subtitle}
              left={<RowIcon name={r.icon} />}
              onPress={() => router.push(r.href)}
              last={i === rows.length - 1}
            />
          ))}
        </Card>

        <Text className="text-[13px] font-bold text-label">{t.setup.account}</Text>
        <Card className="overflow-hidden">
          <ListRow
            title={t.account.title}
            subtitle={me?.user.email}
            left={<RowIcon name="user" />}
            onPress={() => router.push('/setup/account')}
            last
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
