import { Pressable, View } from 'react-native';
import { formatInTimeZone } from 'date-fns-tz';
import type { AppNotification, NotificationType } from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { openBooking } from '@/features/bookings/nav';
import { useMe } from '@/features/me/hooks';
import { useMarkRead, useNotifications } from '@/features/notifications/hooks';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.notifications;

const ICONS: Record<NotificationType, { icon: IconName; bg: string; fg: string }> = {
  booking_new: { icon: 'calendar', bg: 'bg-ok-bg', fg: colors['ok-fg'] },
  booking_paid: { icon: 'check', bg: 'bg-ok-bg', fg: colors['ok-fg'] },
  payment_failed: { icon: 'clock', bg: 'bg-pend-bg', fg: colors['pend-fg'] },
  booking_cancelled: { icon: 'x', bg: 'bg-danger-tint', fg: colors.danger },
  walk_in: { icon: 'walk', bg: 'bg-info-bg', fg: colors['info-fg'] },
  staff_joined: { icon: 'users', bg: 'bg-info-bg', fg: colors['info-fg'] },
  reminders_sent: { icon: 'chat', bg: 'bg-soft', fg: colors.primary },
  trial_ending: { icon: 'clock', bg: 'bg-pend-bg', fg: colors['pend-fg'] },
  trial_ended: { icon: 'clock', bg: 'bg-danger-tint', fg: colors.danger },
};

/** D6 · Notifications: grouped Today / Yesterday / Earlier; tap opens the booking. */
export default function NotificationsScreen() {
  const { me } = useMe();
  const list = useNotifications();
  const markRead = useMarkRead();
  const tz = me?.business.timezone ?? 'Asia/Kuala_Lumpur';

  const right =
    list.data && list.data.unreadCount > 0 ? (
      <Pressable onPress={() => markRead.mutate(undefined)} accessibilityRole="button" className="min-h-[44px] justify-center">
        <Text className="text-[14px] font-bold text-primary">{s.markAllRead}</Text>
      </Pressable>
    ) : undefined;

  if (!list.data) {
    return (
      <StackScreen title={s.title}>
        {list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : <LoadingState />}
      </StackScreen>
    );
  }

  if (!list.data.items.length) {
    return (
      <StackScreen title={s.title}>
        <EmptyState icon={<Icon name="bell" size={32} color={colors.muted} />} title={s.empty} body={s.emptyBody} />
      </StackScreen>
    );
  }

  const day = (iso: string) => formatInTimeZone(new Date(iso), tz, 'yyyy-MM-dd');
  const today = day(new Date().toISOString());
  const yesterday = day(new Date(Date.now() - 86_400_000).toISOString());
  const groups: { title: string; items: AppNotification[] }[] = [
    { title: s.today, items: [] },
    { title: s.yesterday, items: [] },
    { title: s.earlier, items: [] },
  ];
  for (const n of list.data.items) {
    const d = day(n.createdAt);
    groups[d === today ? 0 : d === yesterday ? 1 : 2]!.items.push(n);
  }

  const open = (n: AppNotification) => {
    if (!n.read) markRead.mutate([n.id]);
    if (n.bookingId) openBooking('today', n.bookingId);
  };

  return (
    <StackScreen title={s.title} right={right}>
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <View key={g.title} className="gap-2">
            <Text className="text-[13px] font-bold text-label">{g.title}</Text>
            <Card className="overflow-hidden">
              {g.items.map((n, i) => (
                <Row key={n.id} n={n} tz={tz} first={i === 0} onPress={() => open(n)} />
              ))}
            </Card>
          </View>
        ))}
    </StackScreen>
  );
}

function Row({ n, tz, first, onPress }: { n: AppNotification; tz: string; first: boolean; onPress: () => void }) {
  const look = ICONS[n.type];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${n.read ? '' : `${s.unread}. `}${n.title}. ${n.body ?? ''}`}
      className={`flex-row gap-3 px-3.5 py-3 active:bg-pressed ${first ? '' : 'border-t border-border'} ${n.read ? '' : 'bg-soft'}`}
    >
      <View className={`h-9 w-9 items-center justify-center rounded-full ${look.bg}`}>
        <Icon name={look.icon} size={18} color={look.fg} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className={`text-[14px] ${n.read ? 'font-semibold' : 'font-extrabold'}`}>{n.title}</Text>
        {n.body ? <Text className="text-[13px] text-muted">{n.body}</Text> : null}
      </View>
      <View className="items-end gap-1.5">
        <Text className="text-[12px] text-muted">{formatInTimeZone(new Date(n.createdAt), tz, 'h:mm a')}</Text>
        {n.read ? null : <View className="h-2.5 w-2.5 rounded-full bg-primary" />}
      </View>
    </Pressable>
  );
}
