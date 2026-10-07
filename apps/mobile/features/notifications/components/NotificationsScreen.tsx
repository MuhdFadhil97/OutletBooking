import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { formatInTimeZone } from 'date-fns-tz';
import type { AppNotification, NotificationType } from '@outletbooking/shared';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { t } from '@/strings/en';
import { colors } from '@/theme';
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from '../hooks';

const s = t.notifications;

const LOOK: Record<NotificationType, { icon: IconName; bg: string; fg: string }> = {
  booking_new: { icon: 'calendar', bg: colors['ok-bg'], fg: colors['ok-fg'] },
  booking_paid: { icon: 'check', bg: colors['ok-bg'], fg: colors['ok-fg'] },
  payment_failed: { icon: 'clock', bg: colors['pend-bg'], fg: colors['pend-fg'] },
  booking_cancelled: { icon: 'x', bg: colors['danger-tint'], fg: colors.danger },
  walk_in: { icon: 'walk', bg: colors['info-bg'], fg: colors['info-fg'] },
  staff_joined: { icon: 'users', bg: colors['neutral-bg'], fg: colors['neutral-fg'] },
  reminders_sent: { icon: 'chat', bg: colors['info-bg'], fg: colors['info-fg'] },
  trial_ending: { icon: 'clock', bg: colors['pend-bg'], fg: colors['pend-fg'] },
  trial_ended: { icon: 'clock', bg: colors['danger-tint'], fg: colors.danger },
};

/** "Today" / "Yesterday" / "Sat, 10 Oct" in the business time zone. */
function groupLabel(iso: string, tz: string): string {
  const day = formatInTimeZone(iso, tz, 'yyyy-MM-dd');
  const today = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd');
  const yesterday = formatInTimeZone(new Date(Date.now() - 86_400_000), tz, 'yyyy-MM-dd');
  if (day === today) return s.today;
  if (day === yesterday) return s.yesterday;
  return formatInTimeZone(iso, tz, 'EEE, d MMM');
}

/** D6 · notifications: grouped by day, unread first-class, tap opens the booking. */
export function NotificationsScreen({ timezone, onOpen }: { timezone: string; onOpen: (n: AppNotification) => void }) {
  const list = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const open = (n: AppNotification) => {
    if (!n.read) markRead.mutate(n.id);
    onOpen(n);
  };

  let body;
  if (list.isPending) body = <LoadingState />;
  else if (list.error && !list.data) body = <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  else if (!list.data.items.length) {
    body = <EmptyState icon={<Icon name="bell" size={32} color={colors.muted} />} title={s.emptyTitle} body={s.emptyBody} />;
  } else {
    const groups: { label: string; items: AppNotification[] }[] = [];
    for (const n of list.data.items) {
      const label = groupLabel(n.createdAt, timezone);
      const last = groups[groups.length - 1];
      if (last?.label === label) last.items.push(n);
      else groups.push({ label, items: [n] });
    }
    body = groups.map((g) => (
      <View key={g.label} className="gap-2">
        <Text className="px-1 text-[13px] font-bold text-muted">{g.label}</Text>
        <Card className="overflow-hidden">
          {g.items.map((n, i) => (
            <Row key={n.id} n={n} tz={timezone} first={i === 0} onPress={() => open(n)} />
          ))}
        </Card>
      </View>
    ));
  }

  const unread = list.data?.unread ?? 0;
  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      <View className="flex-row items-center gap-3 px-4 pb-2 pt-3">
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="h-11 w-11 items-center justify-center rounded-button border border-border bg-card active:bg-pressed"
        >
          <Icon name="chevron-left" color={colors.text} />
        </Pressable>
        <View className="flex-1">
          <Text className="text-[20px] font-extrabold">{s.title}</Text>
          {unread ? <Text className="text-[12px] text-muted">{s.unread(unread)}</Text> : null}
        </View>
        {unread ? (
          <Pressable onPress={() => markAll.mutate()} accessibilityRole="button" className="min-h-[44px] justify-center px-1">
            <Text className="text-[14px] font-bold text-primary">{s.markAllRead}</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        contentContainerClassName="gap-4 px-4 pb-8 pt-2"
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={colors.primary} />}
      >
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ n, tz, first, onPress }: { n: AppNotification; tz: string; first: boolean; onPress: () => void }) {
  const look = LOOK[n.type];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className={`min-h-[64px] flex-row items-start gap-3 px-3.5 py-3 active:bg-pressed ${first ? '' : 'border-t border-border'} ${
        n.read ? '' : 'bg-soft'
      }`}
    >
      <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: look.bg }}>
        <Icon name={look.icon} size={18} color={look.fg} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className={`text-[14px] ${n.read ? 'font-semibold' : 'font-extrabold'}`}>{n.title}</Text>
        {n.body ? <Text className="text-[13px] text-muted">{n.body}</Text> : null}
      </View>
      <View className="items-end gap-1.5">
        <Text className="text-[12px] text-muted">{formatInTimeZone(n.createdAt, tz, 'h:mm a')}</Text>
        {n.read ? null : <View className="h-2.5 w-2.5 rounded-full bg-primary" accessibilityLabel="Unread" />}
      </View>
    </Pressable>
  );
}
