import { View } from 'react-native';
import { router } from 'expo-router';
import { formatInTimeZone } from 'date-fns-tz';
import { groupWeeklyHours, type NotificationPrefKey } from '@outletbooking/shared';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SwitchRow } from '@/components/ui/Rows';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Tag } from '@/components/ui/Tag';
import { Text } from '@/components/ui/Text';
import { useLogout } from '@/features/auth/hooks';
import { formatPhone, shiftDate, todayIn } from '@/features/bookings/format';
import { useMe } from '@/features/me/hooks';
import { initials } from '@/features/staff-app/format';
import { useMySchedule, useNotificationPrefs, useUpdateNotificationPrefs } from '@/features/staff-app/hooks';
import { t } from '@/strings/en';

const s = t.staffApp;
const TIME_OFF_DAYS = 30;

/** G3 · My profile: contact details, own working hours (read-only), upcoming time off, push switches, log out. */
export default function StaffProfileScreen() {
  const { me, error, refetch } = useMe();
  const logout = useLogout();
  const tz = me?.business.timezone ?? 'Asia/Kuala_Lumpur';
  const today = todayIn(tz);
  const schedule = useMySchedule(today, shiftDate(today, TIME_OFF_DAYS));
  const prefs = useNotificationPrefs();
  const updatePrefs = useUpdateNotificationPrefs();

  if (!me) {
    return <Screen>{error ? <ErrorState error={error} onRetry={() => void refetch()} /> : <LoadingState />}</Screen>;
  }

  const hours = schedule.data ? groupWeeklyHours(schedule.data.hours) : [];
  const toggle = (key: NotificationPrefKey) => (value: boolean) => updatePrefs.mutate({ [key]: value });

  return (
    <Screen>
      <View className="flex-row items-center gap-3.5 pt-1">
        <View className="h-[60px] w-[60px] items-center justify-center rounded-full bg-info-bg">
          <Text className="text-[20px] font-extrabold text-info-fg">{initials(me.user.name)}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-[20px] font-extrabold">{me.user.name}</Text>
          <Text className="text-[14px] text-muted">{t.account.roleAt(t.account.role[me.role], me.business.name)}</Text>
        </View>
      </View>

      <Card className="overflow-hidden">
        <InfoRow label={s.mobile} value={me.user.phone ? formatPhone(me.user.phone) : t.account.noMobile} />
        <InfoRow label={s.email} value={me.user.email} last />
      </Card>

      <View className="gap-2">
        <Text className="text-[12px] font-extrabold uppercase tracking-[0.6px] text-muted">{s.myHours}</Text>
        {schedule.error ? (
          <ErrorState error={schedule.error} onRetry={() => void schedule.refetch()} />
        ) : !schedule.data ? (
          <LoadingState />
        ) : schedule.data.hours.length === 0 ? (
          <Card className="px-3.5 py-3">
            <Text className="text-[14px] text-muted">{schedule.data.resources.length ? s.noHours : s.noResourceBody}</Text>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            {hours.map((g, i) => (
              <View key={g.days} className={`min-h-[48px] flex-row items-center justify-between px-3.5 py-2.5 ${i < hours.length - 1 ? 'border-b border-border' : ''}`}>
                <Text className="text-[14px]">{g.days}</Text>
                {g.hours ? <Text className="text-[14px] font-bold">{g.hours}</Text> : <Tag label={s.dayOff} tone="neutral" />}
              </View>
            ))}
          </Card>
        )}
        <Text className="text-[12px] text-muted">{s.hoursNote}</Text>
      </View>

      {schedule.data?.timeOff.length ? (
        <View className="gap-2">
          <Text className="text-[12px] font-extrabold uppercase tracking-[0.6px] text-muted">{s.timeOffTitle}</Text>
          <Card className="overflow-hidden">
            {schedule.data.timeOff.map((o, i, all) => (
              <InfoRow
                key={`${o.startAt}-${i}`}
                label={`${formatInTimeZone(new Date(o.startAt), tz, 'EEE d MMM')}${o.resourceId === null ? ` · ${s.closed}` : ''}`}
                value={o.reason ?? s.dayOff}
                last={i === all.length - 1}
              />
            ))}
          </Card>
        </View>
      ) : null}

      <View className="gap-2">
        <Text className="text-[12px] font-extrabold uppercase tracking-[0.6px] text-muted">{s.notifications}</Text>
        <Card className="gap-1 px-3.5 py-2">
          {prefs.error ? (
            <ErrorState error={prefs.error} onRetry={() => void prefs.refetch()} />
          ) : !prefs.data ? (
            <LoadingState />
          ) : (
            <>
              <SwitchRow label={s.notifyNew} value={prefs.data.newBookings} onChange={toggle('newBookings')} />
              <SwitchRow label={s.notifyChanges} value={prefs.data.changes} onChange={toggle('changes')} />
              <SwitchRow label={s.notifySummary} value={prefs.data.daySummary} onChange={toggle('daySummary')} />
            </>
          )}
        </Card>
        <FormError message={updatePrefs.error ? errorMessage(updatePrefs.error) : null} />
        <Text className="text-[12px] text-muted">{s.notifyNote}</Text>
      </View>

      <Button
        variant="secondary"
        title={t.common.logout}
        loading={logout.isPending}
        onPress={() => logout.mutate(undefined, { onSettled: () => router.replace('/login') })}
      />
    </Screen>
  );
}

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View className={`min-h-[48px] flex-row items-center justify-between gap-3 px-3.5 py-2.5 ${last ? '' : 'border-b border-border'}`}>
      <Text className="text-[14px] text-muted">{label}</Text>
      <Text className="flex-shrink text-right text-[14px] font-bold">{value}</Text>
    </View>
  );
}
