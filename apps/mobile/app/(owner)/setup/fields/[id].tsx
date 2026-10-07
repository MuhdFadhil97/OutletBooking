import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  BOOKING_FIELD_TYPES,
  bookingFieldCreateSchema,
  suggestFieldKey,
  type BookingField,
  type BookingFieldCreateInput,
} from '@outletbooking/shared';
import { HeaderIconButton, StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { SectionLabel, SwitchRow } from '@/components/ui/Rows';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useBookingFields, useDeleteBookingField, useSaveBookingField, useServices } from '@/features/setup/hooks';
import { ApiError } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const f = t.setup.fields;

export default function FieldScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const fields = useBookingFields();
  const services = useServices();

  if (!fields.data || !services.data) {
    const error = fields.error ?? services.error;
    return error ? <ErrorState error={error} onRetry={() => void fields.refetch()} /> : <LoadingState />;
  }

  const field = isNew ? undefined : fields.data.find((x) => x.id === Number(id));
  if (!isNew && !field) return <ErrorState error={null} onRetry={() => router.back()} />;

  return (
    <FieldForm
      key={field?.id ?? 'new'}
      field={field}
      services={services.data}
      nextSortOrder={fields.data.reduce((m, x) => Math.max(m, x.sortOrder + 1), 0)}
    />
  );
}

function FieldForm({
  field,
  services,
  nextSortOrder,
}: {
  field?: BookingField;
  services: { id: number; name: string }[];
  nextSortOrder: number;
}) {
  const save = useSaveBookingField(field?.id ?? null);
  const remove = useDeleteBookingField();
  const [keyEdited, setKeyEdited] = useState(!!field);

  const { control, handleSubmit, formState, setValue, setError } = useForm({
    resolver: zodResolver(bookingFieldCreateSchema),
    mode: 'onTouched',
    defaultValues: {
      serviceId: field?.serviceId ?? null,
      fieldKey: field?.fieldKey ?? '',
      label: field?.label ?? '',
      fieldType: field?.fieldType ?? 'text',
      options: field?.options ?? ['', ''],
      isRequired: field?.isRequired ?? false,
      isSearchable: field?.isSearchable ?? false,
      showToStaff: field?.showToStaff ?? true,
      hint: field?.hint ?? '',
      sortOrder: field?.sortOrder ?? nextSortOrder,
      isActive: field?.isActive ?? true,
    } as BookingFieldCreateInput,
  });
  const { errors } = formState;
  const [fieldType, options] = useWatch({ control, name: ['fieldType', 'options'] });

  const onSave = handleSubmit(
    (values) =>
      save.mutate(values, {
        onSuccess: () => router.back(),
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'field_key_taken') setError('fieldKey', { message: err.message });
        },
      }),
    undefined,
  );

  const onDelete = async () => {
    if (!field) return;
    if (await confirm(f.deleteTitle, f.deleteBody, t.setup.delete)) {
      remove.mutate(field.id, { onSuccess: () => router.back() });
    }
  };

  const opts = options ?? [];
  const setOpts = (next: string[]) => setValue('options', next, { shouldDirty: true, shouldValidate: formState.isSubmitted });
  const formError =
    remove.error ?? (save.error && !(save.error instanceof ApiError && save.error.code === 'field_key_taken') ? save.error : null);

  return (
    <StackScreen
      title={field ? f.editTitle : f.newTitle}
      right={field ? <HeaderIconButton icon="trash" label={t.setup.delete} onPress={() => void onDelete()} danger /> : undefined}
      footer={
        <Button
          title={f.save}
          loading={save.isPending}
          onPress={() => {
            // Drop blank dropdown options before validating; other types have none.
            setValue('options', fieldType === 'select' ? opts.map((o) => o.trim()).filter(Boolean) : null);
            void onSave();
          }}
        />
      }
    >
      <FormError message={formError ? errorMessage(formError) : null} />

      <Controller
        control={control}
        name="label"
        render={({ field: fld }) => (
          <TextField
            compact
            label={f.label}
            value={fld.value}
            onChangeText={(v) => {
              fld.onChange(v);
              if (!keyEdited) setValue('fieldKey', suggestFieldKey(v), { shouldValidate: formState.isSubmitted });
            }}
            onBlur={fld.onBlur}
            error={errors.label?.message}
            placeholder="e.g. Plate number"
          />
        )}
      />

      <Controller
        control={control}
        name="hint"
        render={({ field: fld }) => (
          <TextField
            compact
            label={f.hint}
            value={fld.value ?? ''}
            onChangeText={fld.onChange}
            onBlur={fld.onBlur}
            error={errors.hint?.message}
            hint={f.hintHint}
            placeholder="e.g. WXY 1234"
          />
        )}
      />

      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{f.type}</Text>
        <Controller
          control={control}
          name="fieldType"
          render={({ field: fld }) => (
            <View className="flex-row flex-wrap gap-2">
              {BOOKING_FIELD_TYPES.map((type) => (
                <Chip key={type} role="radio" label={f.types[type]} selected={fld.value === type} onPress={() => fld.onChange(type)} />
              ))}
            </View>
          )}
        />
      </View>

      {fieldType === 'select' ? (
        <Card className="gap-2 px-4 py-3">
          <SectionLabel label={f.options} action={{ label: f.addOption, onPress: () => setOpts([...opts, '']) }} />
          {opts.map((o, i) => (
            <View key={i} className="flex-row items-center gap-2">
              <View className="flex-1">
                <TextField
                  compact
                  label={f.optionPlaceholder(i + 1)}
                  value={o}
                  onChangeText={(v) => setOpts(opts.map((x, j) => (j === i ? v : x)))}
                />
              </View>
              <Pressable
                onPress={() => setOpts(opts.filter((_, j) => j !== i))}
                accessibilityRole="button"
                accessibilityLabel={`${t.setup.delete} ${f.optionPlaceholder(i + 1)}`}
                className="mt-6 h-11 w-11 items-center justify-center"
              >
                <Icon name="x" size={18} color={colors.muted} />
              </Pressable>
            </View>
          ))}
          {errors.options?.message ? <Text className="text-[12px] text-danger">{errors.options.message}</Text> : null}
        </Card>
      ) : null}

      <Card className="gap-2 px-4 py-3">
        <Controller
          control={control}
          name="isRequired"
          render={({ field: fld }) => <SwitchRow label={f.required} value={fld.value ?? false} onChange={fld.onChange} />}
        />
        <Controller
          control={control}
          name="isSearchable"
          render={({ field: fld }) => (
            <SwitchRow label={f.searchable} hint={f.searchableHint} value={fld.value ?? false} onChange={fld.onChange} />
          )}
        />
        <Controller
          control={control}
          name="showToStaff"
          render={({ field: fld }) => (
            <SwitchRow label={f.showToStaff} hint={f.showToStaffHint} value={fld.value ?? true} onChange={fld.onChange} />
          )}
        />
        <Controller
          control={control}
          name="isActive"
          render={({ field: fld }) => <SwitchRow label={f.active} value={fld.value ?? true} onChange={fld.onChange} />}
        />
      </Card>

      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{f.appliesTo}</Text>
        <Controller
          control={control}
          name="serviceId"
          render={({ field: fld }) => (
            <View className="flex-row flex-wrap gap-2">
              <Chip role="radio" label={f.allServices} selected={fld.value == null} onPress={() => fld.onChange(null)} />
              {services.map((s) => (
                <Chip key={s.id} role="radio" label={s.name} selected={fld.value === s.id} onPress={() => fld.onChange(s.id)} />
              ))}
            </View>
          )}
        />
      </View>

      <Controller
        control={control}
        name="fieldKey"
        render={({ field: fld }) => (
          <TextField
            compact
            label={f.key}
            hint={f.keyHint}
            value={fld.value}
            onChangeText={(v) => {
              setKeyEdited(true);
              fld.onChange(v.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
            }}
            onBlur={fld.onBlur}
            error={errors.fieldKey?.message}
            autoCapitalize="none"
            autoCorrect={false}
          />
        )}
      />
    </StackScreen>
  );
}
