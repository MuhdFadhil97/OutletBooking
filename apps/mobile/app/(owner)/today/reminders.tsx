import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { formatInTimeZone } from 'date-fns-tz';
import { DEFAULT_REMINDER_TEMPLATE, fillReminder, type Booking, type BusinessProfile } from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { formatDayTitle, shiftDate, todayIn, whatsappUrl } from '@/features/bookings/format';
import { useBookingsRange, useMarkReminderSent } from '@/features/bookings/hooks';
import { useBusiness, useUpdateBusiness } from '@/features/setup/hooks';
import { formatDuration } from '@/lib/format';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.reminders;

/** D5 · Remind tomorrow's customers: message template, progress, one-tap WhatsApp per customer. */
export default function RemindersScreen() {
  const business = useBusiness();
  const tz = business.data?.timezone ?? 'Asia/Kuala_Lumpur';
  const tomorrow = shiftDate(todayIn(tz), 1);
  const day = useBookingsRange(tomorrow, shiftDate(tomorrow, 1));

  if (business.isPending || day.isPending) return <LoadingState />;
  if (business.error || day.error) {
    return <ErrorState error={business.error ?? day.error} onRetry={() => void day.refetch()} />;
  }
  // Only bookings that start tomorrow and are still on.
  const list = day.data.filter(
    (b) => formatInTimeZone(b.startAt, tz, 'yyyy-MM-dd') === tomorrow && (b.status === 'pending' || b.status === 'confirmed'),
  );
  return <Reminders biz={business.data} list={list} date={tomorrow} />;
}

function Reminders({ biz, list, date }: { biz: BusinessProfile; list: Booking[]; date: string }) {
  const mark = useMarkReminderSent();
  const [editing, setEditing] = useState(false);
  const tz = biz.timezone;
  const template = typeof biz.settings.reminderTemplate === 'string' && biz.settings.reminderTemplate ? biz.settings.reminderTemplate : DEFAULT_REMINDER_TEMPLATE;

  const messageFor = (b: Booking) =>
    fillReminder(template, {
      name: b.customer.name.split(' ')[0] ?? b.customer.name,
      service: b.service.name,
      business: biz.name,
      time: formatInTimeZone(b.startAt, tz, 'h:mm a'),
      date: formatInTimeZone(b.startAt, tz, 'EEE, d MMM'),
      resource: b.resource.name,
      ref: b.ref,
    });
  const send = (b: Booking) => {
    if (!b.customer.phone) return;
    void Linking.openURL(`${whatsappUrl(b.customer.phone)}?text=${encodeURIComponent(messageFor(b))}`);
    mark.mutate(b.id);
  };

  const sentCount = list.filter((b) => b.reminderSentAt).length;
  const next = list.find((b) => !b.reminderSentAt && b.customer.phone);
  const preview = list[0] ? messageFor(list[0]) : template;

  return (
    <StackScreen
      title={s.title}
      subtitle={s.subtitle(formatDayTitle(date), list.length)}
      footer={
        list.length ? (
          next ? (
            <Button title={s.sendNext(next.customer.name)} loading={mark.isPending} onPress={() => send(next)} />
          ) : (
            <Text className="py-3 text-center text-[14px] font-bold text-ok-fg">{s.allSent}</Text>
          )
        ) : undefined
      }
    >
      <FormError message={mark.error ? errorMessage(mark.error) : null} />
      <Card className="gap-2 p-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-[13px] font-bold text-label">{s.message}</Text>
          <Pressable onPress={() => setEditing(true)} accessibilityRole="button" className="min-h-[44px] justify-center px-1">
            <Text className="text-[14px] font-bold text-primary">{s.edit}</Text>
          </Pressable>
        </View>
        <View className="rounded-input bg-soft px-3 py-2.5">
          <Text className="text-[14px]">{preview}</Text>
        </View>
      </Card>

      {list.length ? (
        <>
          <View className="gap-1.5">
            <Text className="text-[13px] font-bold text-muted">{s.progress(sentCount, list.length)}</Text>
            <View className="h-1.5 overflow-hidden rounded-full bg-soft">
              <View className="h-1.5 bg-primary" style={{ width: `${(sentCount / list.length) * 100}%` }} />
            </View>
          </View>
          <Card className="overflow-hidden">
            {list.map((b, i) => (
              <View key={b.id} className={`min-h-[60px] flex-row items-center gap-3 px-3.5 py-2.5 ${i ? 'border-t border-border' : ''}`}>
                <Text className="w-[58px] text-[13px] font-bold">{formatInTimeZone(b.startAt, tz, 'h:mm a')}</Text>
                <View className="flex-1">
                  <Text className="text-[15px] font-bold" numberOfLines={1}>
                    {b.customer.name}
                  </Text>
                  <Text className="text-[12px] text-muted">{`${b.resource.name} · ${formatDuration(b.durationMin)}`}</Text>
                </View>
                {b.reminderSentAt ? (
                  <Pressable onPress={() => send(b)} accessibilityRole="button" className="min-h-[44px] justify-center px-1">
                    <Text className="text-[13px] font-bold text-ok-fg">{s.sent}</Text>
                  </Pressable>
                ) : b.customer.phone ? (
                  <Pressable
                    onPress={() => send(b)}
                    accessibilityRole="button"
                    className="h-11 flex-row items-center gap-1.5 rounded-button bg-primary px-3.5 active:bg-primary-pressed"
                  >
                    <Icon name="chat" size={16} color="#FFFFFF" />
                    <Text className="text-[14px] font-bold text-white">{s.send}</Text>
                  </Pressable>
                ) : (
                  <Text className="text-[12px] text-muted">{s.noPhone}</Text>
                )}
              </View>
            ))}
          </Card>
          <Text className="text-center text-[12px] text-muted">{s.hint}</Text>
        </>
      ) : (
        <Card>
          <EmptyState icon={<Icon name="calendar" size={32} color={colors.muted} />} title={s.emptyTitle} body={s.emptyBody} />
        </Card>
      )}

      <TemplateSheet visible={editing} value={template} onClose={() => setEditing(false)} />
    </StackScreen>
  );
}

function TemplateSheet({ visible, value, onClose }: { visible: boolean; value: string; onClose: () => void }) {
  const save = useUpdateBusiness();
  const [text, setText] = useState(value);
  return (
    <Sheet visible={visible} title={s.editTitle} onClose={onClose}>
      <TextField compact label={s.message} value={text} onChangeText={setText} multiline hint={s.editHint} maxLength={1000} />
      <FormError message={save.error ? errorMessage(save.error) : null} />
      <Button
        title={s.save}
        loading={save.isPending}
        disabled={!text.trim()}
        onPress={() => save.mutate({ settings: { reminderTemplate: text.trim() } }, { onSuccess: onClose })}
      />
    </Sheet>
  );
}
