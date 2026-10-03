import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  RESOURCE_TYPES,
  resourceCreateSchema,
  workingHoursSchema,
  type Resource,
  type ResourceCreate,
  type WorkingHourInput,
} from '@outletbooking/shared';
import { HeaderIconButton, StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { SectionLabel, SwitchRow } from '@/components/ui/Rows';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import * as api from '@/features/setup/api';
import { WorkingHoursEditor } from '@/features/setup/components/WorkingHoursEditor';
import { formatTimeOffRange } from '@/features/setup/format';
import {
  setupKeys,
  useArchiveResource,
  useBusiness,
  useResources,
  useServices,
  useTimeOff,
  useWorkingHours,
} from '@/features/setup/hooks';
import { ApiError } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { t } from '@/strings/en';

const r = t.setup.resources;

const sameHours = (a: WorkingHourInput[], b: WorkingHourInput[]) => {
  const key = (x: WorkingHourInput[]) =>
    x
      .map((h) => `${h.weekday}${h.startTime}${h.endTime}`)
      .sort()
      .join('|');
  return key(a) === key(b);
};

/** O6 · one resource: details, services, weekly hours (with breaks), copy hours, time off. */
export default function ResourceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const resources = useResources();
  const services = useServices();
  const business = useBusiness();
  const resourceId = isNew ? null : Number(id);
  const hours = useWorkingHours(resourceId);

  if (resources.isPending || services.isPending || business.isPending || (!isNew && hours.isPending)) {
    return <LoadingState />;
  }
  const error = resources.error ?? services.error ?? business.error ?? hours.error;
  if (error) return <ErrorState error={error} onRetry={() => void resources.refetch()} />;

  const resource = isNew ? undefined : resources.data?.find((x) => x.id === resourceId);
  if (!isNew && !resource) return <ErrorState error={null} onRetry={() => router.back()} />;

  return (
    <ResourceForm
      key={resource?.id ?? 'new'}
      resource={resource}
      others={(resources.data ?? []).filter((x) => x.id !== resourceId)}
      services={services.data ?? []}
      label={business.data?.resourceLabel ?? 'Resource'}
      tz={business.data?.timezone ?? 'Asia/Kuala_Lumpur'}
      savedHours={(hours.data ?? []).map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime }))}
      count={resources.data?.length ?? 0}
    />
  );
}

function ResourceForm({
  resource,
  others,
  services,
  label,
  tz,
  savedHours,
  count,
}: {
  resource?: Resource;
  others: Resource[];
  services: { id: number; name: string }[];
  label: string;
  tz: string;
  savedHours: WorkingHourInput[];
  count: number;
}) {
  const qc = useQueryClient();
  const archive = useArchiveResource();
  const timeOff = useTimeOff();
  const [hours, setHours] = useState<WorkingHourInput[]>(savedHours);
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);

  const { control, handleSubmit, formState } = useForm({
    resolver: zodResolver(resourceCreateSchema),
    mode: 'onTouched',
    defaultValues: {
      name: resource?.name ?? '',
      resourceType: resource?.resourceType ?? (label.toLowerCase() === 'agent' ? 'staff' : guessType(label)),
      isActive: resource?.isActive ?? true,
      sortOrder: resource?.sortOrder ?? count,
      // New resources offer every service by default; the owner can untick.
      serviceIds: resource?.serviceIds ?? services.map((s) => s.id),
    } as ResourceCreate,
  });
  const { errors } = formState;
  const hoursDirty = !sameHours(hours, savedHours);

  /** Saves details, then hours (needs the id when creating). */
  const save = useMutation({
    mutationFn: async (values: ResourceCreate) => {
      const parsed = workingHoursSchema.safeParse({ hours });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid hours');
      const saved = resource ? await api.updateResource(resource.id, values) : await api.createResource(values);
      if (hoursDirty || !resource) await api.setWorkingHours(saved.id, parsed.data.hours);
      return saved;
    },
    onSuccess: async (saved) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: setupKeys.resources }),
        qc.invalidateQueries({ queryKey: setupKeys.services }),
        qc.invalidateQueries({ queryKey: setupKeys.hours(saved.id) }),
      ]);
      router.back();
    },
  });

  const copy = useMutation({
    mutationFn: async (toIds: number[]) => {
      if (!resource) return;
      const parsed = workingHoursSchema.parse({ hours });
      if (hoursDirty) await api.setWorkingHours(resource.id, parsed.hours); // copy what is on screen
      await api.copyWorkingHours(resource.id, toIds);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['working-hours'] });
      setCopyOpen(false);
    },
  });

  const onSave = handleSubmit((values) => {
    const check = workingHoursSchema.safeParse({ hours });
    setHoursError(check.success ? null : (check.error.issues[0]?.message ?? 'Invalid hours'));
    if (check.success) save.mutate(values);
  });

  const onArchive = async () => {
    if (!resource) return;
    if (!(await confirm(r.archiveTitle(label), r.archiveBody, t.setup.archive))) return;
    archive.mutate(resource.id, { onSuccess: () => router.back() });
  };

  const myTimeOff = (timeOff.data ?? []).filter((x) => x.resourceId === null || x.resourceId === resource?.id);
  const formError = save.error ?? archive.error ?? copy.error;

  return (
    <StackScreen
      title={resource?.name ?? r.newTitle(label)}
      right={resource ? <HeaderIconButton icon="trash" label={t.setup.archive} onPress={() => void onArchive()} danger /> : undefined}
      footer={<Button title={r.save} loading={save.isPending} onPress={onSave} />}
    >
      <FormError message={formError ? (formError instanceof ApiError ? errorMessage(formError) : formError.message) : null} />

      <Card className="gap-4 p-4">
        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <TextField compact label={r.name} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.name?.message} placeholder={`${label} 1`} />
          )}
        />
        <View className="gap-2">
          <Text className="text-[13px] font-bold text-label">{r.type}</Text>
          <Controller
            control={control}
            name="resourceType"
            render={({ field }) => (
              <View className="flex-row flex-wrap gap-2">
                {RESOURCE_TYPES.map((type) => (
                  <Chip key={type} role="radio" label={r.types[type]} selected={field.value === type} onPress={() => field.onChange(type)} />
                ))}
              </View>
            )}
          />
        </View>
        <Controller
          control={control}
          name="isActive"
          render={({ field }) => <SwitchRow label={r.active} value={field.value ?? true} onChange={field.onChange} />}
        />
        {resource ? (
          <View className="gap-0.5">
            <Text className="text-[13px] font-bold text-label">{r.linkedStaff}</Text>
            <Text className="text-[14px] text-muted">
              {resource.linkedUser ? `${resource.linkedUser.name} · ${resource.linkedUser.email}` : r.noLinkedStaff}
            </Text>
          </View>
        ) : null}
      </Card>

      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{r.services}</Text>
        <Controller
          control={control}
          name="serviceIds"
          render={({ field }) => (
            <View className="flex-row flex-wrap gap-2">
              {services.map((s) => {
                const ids = field.value ?? [];
                const on = ids.includes(s.id);
                return (
                  <Chip key={s.id} label={s.name} selected={on} onPress={() => field.onChange(on ? ids.filter((x) => x !== s.id) : [...ids, s.id])} />
                );
              })}
            </View>
          )}
        />
      </View>

      <Card className="px-4 pt-3">
        <SectionLabel label={r.hours} />
        <FormError message={hoursError} />
        <WorkingHoursEditor
          value={hours}
          onChange={(h) => {
            setHours(h);
            setHoursError(null);
          }}
        />
        {resource && others.length ? (
          <Button
            variant="secondary"
            title={r.copyHours(label)}
            onPress={() => setCopyOpen(true)}
            className="my-3"
          />
        ) : (
          <View className="h-3" />
        )}
      </Card>

      {resource ? (
        <Card className="gap-1 px-4 py-3">
          <SectionLabel
            label={r.timeOff}
            action={{
              label: t.setup.timeOff.add,
              onPress: () => router.push({ pathname: '/setup/time-off', params: { resourceId: String(resource.id) } }),
            }}
          />
          {myTimeOff.length === 0 ? <Text className="pb-1 text-[14px] text-muted">{t.setup.timeOff.empty}</Text> : null}
          {myTimeOff.map((x) => (
            <View key={x.id} className="py-1.5">
              <Text className="text-[14px] font-semibold">
                {x.resourceId === null ? `${t.setup.timeOff.wholeBusiness} · ` : ''}
                {x.reason ?? r.timeOff}
              </Text>
              <Text className="text-[12px] text-muted">{formatTimeOffRange(x.startAt, x.endAt, tz)}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      <CopyHoursSheet
        visible={copyOpen}
        label={label}
        others={others}
        loading={copy.isPending}
        onClose={() => setCopyOpen(false)}
        onCopy={(ids) => copy.mutate(ids)}
      />
    </StackScreen>
  );
}

function guessType(label: string): ResourceCreate['resourceType'] {
  const l = label.toLowerCase();
  return (RESOURCE_TYPES as readonly string[]).includes(l) ? (l as ResourceCreate['resourceType']) : 'other';
}

function CopyHoursSheet({
  visible,
  label,
  others,
  loading,
  onClose,
  onCopy,
}: {
  visible: boolean;
  label: string;
  others: Resource[];
  loading: boolean;
  onClose: () => void;
  onCopy: (ids: number[]) => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  // Preselect everything each time the sheet opens (`others` is a new array every render).
  useEffect(() => {
    if (visible) setSelected(others.map((o) => o.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  return (
    <Sheet visible={visible} title={r.copyTitle} onClose={onClose}>
      <Text className="text-[14px] text-muted">{r.copyBody(label)}</Text>
      <View className="flex-row flex-wrap gap-2">
        {others.map((o) => {
          const on = selected.includes(o.id);
          return (
            <Chip
              key={o.id}
              label={o.name}
              selected={on}
              onPress={() => setSelected((cur) => (on ? cur.filter((x) => x !== o.id) : [...cur, o.id]))}
            />
          );
        })}
      </View>
      <Button title={r.copyTitle} loading={loading} disabled={!selected.length} onPress={() => onCopy(selected)} />
    </Sheet>
  );
}
