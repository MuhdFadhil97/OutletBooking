import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { addDays, format, parseISO } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { timeOffCreateSchema, type Resource } from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { DateSelect } from '@/components/ui/DateSelect';
import { Icon } from '@/components/ui/Icon';
import { SectionLabel, SwitchRow } from '@/components/ui/Rows';
import { EmptyState, ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { TimeSelect } from '@/components/ui/TimeSelect';
import { formatTimeOffRange } from '@/features/setup/format';
import { useBusiness, useCreateTimeOff, useDeleteTimeOff, useResources, useTimeOff } from '@/features/setup/hooks';
import { confirm } from '@/lib/confirm';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const o = t.setup.timeOff;

/** FR-04.3 · Time off per resource or the whole business (public holidays, leave, closures). */
export default function TimeOffScreen() {
  const params = useLocalSearchParams<{ resourceId?: string }>();
  const preselect = params.resourceId ? Number(params.resourceId) : undefined;
  const [adding, setAdding] = useState(preselect !== undefined);
  const timeOff = useTimeOff();
  const resources = useResources();
  const business = useBusiness();
  const remove = useDeleteTimeOff();

  if (!timeOff.data || !resources.data || !business.data) {
    const error = timeOff.error ?? resources.error ?? business.error;
    return error ? <ErrorState error={error} onRetry={() => void timeOff.refetch()} /> : <LoadingState />;
  }

  const tz = business.data.timezone;
  const resourceName = new Map(resources.data.map((r) => [r.id, r.name]));

  const onDelete = async (id: number) => {
    if (await confirm(o.deleteTitle, o.deleteBody, t.setup.delete)) remove.mutate(id);
  };

  return (
    <StackScreen title={o.title}>
      <FormError message={remove.error ? errorMessage(remove.error) : null} />
      <Card className="gap-1 px-4 py-3">
        <SectionLabel label={o.title} action={{ label: o.add, onPress: () => setAdding(true) }} />
        {timeOff.data.length === 0 ? (
          <EmptyState icon={<Icon name="pause" size={28} color={colors.muted} />} title={o.empty} body={o.emptyBody} />
        ) : (
          timeOff.data.map((x, i) => (
            <View
              key={x.id}
              className={`flex-row items-center gap-2 py-2.5 ${i < timeOff.data.length - 1 ? 'border-b border-border' : ''}`}
            >
              <View className="flex-1 gap-0.5">
                <Text className="text-[14px] font-semibold">
                  {x.resourceId === null ? o.wholeBusiness : (resourceName.get(x.resourceId) ?? '—')}
                  {x.reason ? ` · ${x.reason}` : ''}
                </Text>
                <Text className="text-[12px] text-muted">{formatTimeOffRange(x.startAt, x.endAt, tz)}</Text>
              </View>
              <Pressable
                onPress={() => void onDelete(x.id)}
                accessibilityRole="button"
                accessibilityLabel={t.setup.delete}
                className="h-11 w-11 items-center justify-center"
              >
                <Icon name="trash" size={18} color={colors.danger} />
              </Pressable>
            </View>
          ))
        )}
      </Card>

      <AddTimeOffSheet
        visible={adding}
        onClose={() => setAdding(false)}
        resources={resources.data}
        tz={tz}
        preselect={preselect}
      />
    </StackScreen>
  );
}

function AddTimeOffSheet({
  visible,
  onClose,
  resources,
  tz,
  preselect,
}: {
  visible: boolean;
  onClose: () => void;
  resources: Resource[];
  tz: string;
  preselect?: number;
}) {
  const create = useCreateTimeOff();
  const today = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd');
  const [resourceId, setResourceId] = useState<number | null>(preselect ?? null);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('13:00');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  /** Local date + time in the business timezone → UTC ISO. "24:00" = start of the next day. */
  const at = (date: string, time: string) =>
    time === '24:00'
      ? fromZonedTime(`${format(addDays(parseISO(date), 1), 'yyyy-MM-dd')}T00:00:00`, tz)
      : fromZonedTime(`${date}T${time}:00`, tz);

  const submit = () => {
    const startAt = allDay ? at(from, '00:00') : at(from, startTime);
    const endAt = allDay ? at(to, '24:00') : at(to, endTime);
    const body = { resourceId, startAt: startAt.toISOString(), endAt: endAt.toISOString(), reason: reason.trim() || null };
    const check = timeOffCreateSchema.safeParse(body);
    if (!check.success) return setError(o.rangeError);
    setError(null);
    create.mutate(body, {
      onSuccess: () => {
        setReason('');
        onClose();
      },
    });
  };

  return (
    <Sheet visible={visible} title={o.newTitle} onClose={onClose}>
      <FormError message={error ?? (create.error ? errorMessage(create.error) : null)} />
      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{o.appliesTo}</Text>
        <View className="flex-row flex-wrap gap-2">
          <Chip role="radio" label={o.wholeBusiness} selected={resourceId === null} onPress={() => setResourceId(null)} />
          {resources.map((r) => (
            <Chip key={r.id} role="radio" label={r.name} selected={resourceId === r.id} onPress={() => setResourceId(r.id)} />
          ))}
        </View>
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1 gap-1.5">
          <Text className="text-[13px] font-bold text-label">{o.from}</Text>
          <DateSelect
            label={o.from}
            value={from}
            min={today}
            onChange={(d) => {
              setFrom(d);
              if (to < d) setTo(d);
            }}
          />
        </View>
        <View className="flex-1 gap-1.5">
          <Text className="text-[13px] font-bold text-label">{o.to}</Text>
          <DateSelect label={o.to} value={to} min={from} onChange={setTo} />
        </View>
      </View>
      <SwitchRow label={o.allDay} value={allDay} onChange={setAllDay} />
      {!allDay ? (
        <View className="flex-row gap-3">
          <View className="gap-1.5">
            <Text className="text-[13px] font-bold text-label">{o.startTime}</Text>
            <TimeSelect label={o.startTime} value={startTime} onChange={setStartTime} />
          </View>
          <View className="gap-1.5">
            <Text className="text-[13px] font-bold text-label">{o.endTime}</Text>
            <TimeSelect label={o.endTime} value={endTime} onChange={setEndTime} allowMidnightEnd min={from === to ? startTime : undefined} />
          </View>
        </View>
      ) : null}
      <TextField compact label={o.reason} hint={o.reasonHint} value={reason} onChangeText={setReason} maxLength={200} />
      <Button title={o.save} loading={create.isPending} onPress={submit} />
    </Sheet>
  );
}
