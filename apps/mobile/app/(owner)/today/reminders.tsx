import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { parseISO, format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import type { Booking } from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { whatsappUrl } from '@/features/bookings/format';
import { useMe } from '@/features/me/hooks';
import { useMarkReminderSent, useReminders } from '@/features/payments/hooks';
import { useIsOffline } from '@/lib/network';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.reminders;

/** Fills {name} {service} {business} {time} {resource} in the reminder template. */
function fill(template: string, b: Booking, business: string, tz: string) {
  const values: Record<string, string> = {
    name: b.customer.name.split(/\s+/)[0] ?? b.customer.name,
    service: b.service.name,
    business,
    time: formatInTimeZone(new Date(b.startAt), tz, 'h:mm a'),
    resource: b.resource.name,
  };
  return template.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);
}

/** D5 · Remind tomorrow's customers: one tap opens WhatsApp with the message ready, then marks it sent. */
export default function RemindersScreen() {
  const { me } = useMe();
  const list = useReminders();
  const mark = useMarkReminderSent();
  const offline = useIsOffline();
  const [template, setTemplate] = useState<string>(s.template);
  const [editing, setEditing] = useState(false);

  if (list.isPending || !me) return <StackScreen title={s.title}>{list.error ? null : <LoadingState />}</StackScreen>;
  if (list.error) {
    return (
      <StackScreen title={s.title}>
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      </StackScreen>
    );
  }

  const tz = me.business.timezone;
  const rows = list.data.bookings;
  const sentCount = rows.filter((b) => b.reminderSentAt).length;
  const next = rows.find((b) => !b.reminderSentAt && b.customer.phone);

  const send = (b: Booking) => {
    if (!b.customer.phone) return;
    const msg = fill(template, b, me.business.name, tz);
    void Linking.openURL(`${whatsappUrl(b.customer.phone)}?text=${encodeURIComponent(msg)}`);
    mark.mutate(b.id);
  };

  return (
    <StackScreen
      title={s.title}
      subtitle={`${format(parseISO(list.data.date), 'EEE, d MMM')} · ${s.count(rows.length)}`}
      footer={
        rows.length ? (
          next ? (
            <Button title={s.sendNext(next.customer.name)} disabled={offline} onPress={() => send(next)} />
          ) : (
            <Text className="text-center text-[14px] font-bold text-ok-fg">{s.allSent}</Text>
          )
        ) : undefined
      }
    >
      {!rows.length ? (
        <EmptyState icon={<Icon name="calendar" size={32} color={colors.muted} />} title={s.empty} body={s.emptyBody} />
      ) : (
        <>
          <Card className="gap-2 p-3.5">
            <View className="flex-row items-center justify-between">
              <Text className="text-[13px] font-bold text-label">{s.message}</Text>
              <Pressable onPress={() => setEditing((e) => !e)} accessibilityRole="button" className="min-h-[36px] justify-center">
                <Text className="text-[14px] font-bold text-primary">{editing ? s.done : s.edit}</Text>
              </Pressable>
            </View>
            {editing ? (
              <TextField compact label={s.message} hint={s.placeholders} value={template} onChangeText={setTemplate} multiline />
            ) : (
              <Text className="text-[14px]">{fill(template, rows[0]!, me.business.name, tz)}</Text>
            )}
          </Card>

          <View className="gap-1.5">
            <Text className="text-[13px] font-bold text-label">{s.progress(sentCount, rows.length)}</Text>
            <View className="h-1.5 overflow-hidden rounded-full bg-border">
              <View className="h-full bg-primary" style={{ width: `${(sentCount / rows.length) * 100}%` }} />
            </View>
          </View>

          <FormError message={mark.error ? errorMessage(mark.error) : null} />
          <Card className="overflow-hidden">
            {rows.map((b, i) => (
              <View key={b.id} className={`min-h-[60px] flex-row items-center gap-3 px-3.5 py-2.5 ${i ? 'border-t border-border' : ''}`}>
                <Text className="w-[64px] text-[14px] font-extrabold">{formatInTimeZone(new Date(b.startAt), tz, 'h:mm a')}</Text>
                <View className="flex-1">
                  <Text className="text-[14px] font-bold" numberOfLines={1}>
                    {b.customer.name}
                  </Text>
                  <Text className="text-[12px] text-muted" numberOfLines={1}>
                    {b.resource.name} · {t.today.hours(b.durationMin)}
                  </Text>
                </View>
                {b.reminderSentAt ? (
                  <Text className="text-[13px] font-bold text-ok-fg">{s.sent}</Text>
                ) : b.customer.phone ? (
                  <Button title={s.send} variant="secondary" className="w-[84px]" disabled={offline} onPress={() => send(b)} />
                ) : (
                  <Text className="text-[12px] text-muted">{s.noPhone}</Text>
                )}
              </View>
            ))}
          </Card>
          <Text className="text-[12px] text-muted">{s.hint}</Text>
        </>
      )}
    </StackScreen>
  );
}
