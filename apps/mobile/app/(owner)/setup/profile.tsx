import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  businessProfileSchema,
  normalizeMyPhone,
  type BusinessProfile,
  type BusinessProfileInput,
} from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChipChoice } from '@/components/ui/Chip';
import { SectionLabel, SwitchRow } from '@/components/ui/Rows';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useBusiness, useUpdateBusiness } from '@/features/setup/hooks';
import { formatDuration } from '@/lib/format';
import { t } from '@/strings/en';

const p = t.setup.profile;

const SLOT_INTERVALS = [15, 30, 60, 90, 120] as const;
const MIN_ADVANCE = [0, 30, 60, 120, 240, 1440] as const;
const CANCEL_CUTOFF = [0, 60, 120, 1440, 2880] as const;
const MAX_DAYS = [7, 14, 30, 60, 90] as const;

const leadTime = (min: number) => (min === 0 ? p.none : p.before(formatDuration(min)));

function toForm(b: BusinessProfile): BusinessProfileInput {
  return {
    name: b.name,
    phone: b.phone ?? '',
    whatsappPhone: b.whatsappPhone ?? '',
    email: b.email ?? '',
    address: b.address ?? '',
    description: b.description ?? '',
    resourceLabel: b.resourceLabel,
    slotIntervalMin: b.slotIntervalMin,
    minAdvanceMin: b.minAdvanceMin,
    maxDaysAhead: b.maxDaysAhead,
    cancelCutoffMin: b.cancelCutoffMin,
    bookingEnabled: b.bookingEnabled,
  };
}

/** FR-02.1/02.2/02.4: profile, booking rules, resource label. */
export default function ProfileScreen() {
  const business = useBusiness();
  if (business.isPending) return <LoadingState />;
  if (business.error) return <ErrorState error={business.error} onRetry={() => void business.refetch()} />;
  return <ProfileForm business={business.data} />;
}

function ProfileForm({ business }: { business: BusinessProfile }) {
  const save = useUpdateBusiness();
  const { control, handleSubmit, formState, reset } = useForm({
    resolver: zodResolver(businessProfileSchema),
    mode: 'onTouched',
    defaultValues: toForm(business) as BusinessProfileInput,
  });
  const { errors, isDirty } = formState;

  useEffect(() => reset(toForm(business)), [business, reset]);

  const onSave = handleSubmit((values) =>
    save.mutate(values, { onSuccess: () => router.back() }),
  );

  const text = (
    name: 'name' | 'address' | 'description' | 'resourceLabel' | 'email',
    label: string,
    extra: Partial<React.ComponentProps<typeof TextField>> = {},
  ) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <TextField
          compact
          label={label}
          value={field.value ?? ''}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          error={errors[name]?.message}
          {...extra}
        />
      )}
    />
  );

  const phone = (name: 'phone' | 'whatsappPhone', label: string, hint?: string) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <TextField
          compact
          label={label}
          value={field.value ?? ''}
          onChangeText={field.onChange}
          onBlur={() => {
            if (field.value) field.onChange(normalizeMyPhone(field.value));
            field.onBlur();
          }}
          error={errors[name]?.message}
          hint={hint ?? t.signup.phoneHint}
          keyboardType="phone-pad"
        />
      )}
    />
  );

  return (
    <StackScreen
      title={p.title}
      subtitle={business.slug}
      footer={<Button title={t.setup.save} loading={save.isPending} disabled={!isDirty} onPress={onSave} />}
    >
      <FormError message={save.error ? errorMessage(save.error) : null} />

      <SectionLabel label={p.details} />
      <Card className="gap-4 p-4">
        {text('name', p.name, { autoCapitalize: 'words' })}
        {phone('phone', p.phone)}
        {phone('whatsappPhone', p.whatsapp, p.whatsappHint)}
        {text('email', p.email, { autoCapitalize: 'none', keyboardType: 'email-address' })}
        {text('address', p.address, { multiline: true })}
        {text('description', p.description, { multiline: true, hint: p.descriptionHint })}
        {text('resourceLabel', p.resourceLabel, { hint: p.resourceLabelHint, autoCapitalize: 'words' })}
      </Card>

      <SectionLabel label={p.rules} />
      <Card className="gap-4 p-4">
        <Controller
          control={control}
          name="bookingEnabled"
          render={({ field }) => (
            <SwitchRow label={p.bookingEnabled} hint={p.bookingEnabledHint} value={field.value} onChange={field.onChange} />
          )}
        />
        <View className="gap-2">
          <Text className="text-[13px] font-bold text-label">{p.slotInterval}</Text>
          <Controller
            control={control}
            name="slotIntervalMin"
            render={({ field }) => (
              <ChipChoice options={SLOT_INTERVALS} value={field.value} onChange={field.onChange} format={formatDuration} />
            )}
          />
        </View>
        <View className="gap-2">
          <Text className="text-[13px] font-bold text-label">{p.minAdvance}</Text>
          <Text className="text-[12px] text-muted">{p.minAdvanceHint}</Text>
          <Controller
            control={control}
            name="minAdvanceMin"
            render={({ field }) => (
              <ChipChoice options={MIN_ADVANCE} value={field.value} onChange={field.onChange} format={leadTime} />
            )}
          />
        </View>
        <View className="gap-2">
          <Text className="text-[13px] font-bold text-label">{p.maxDaysAhead}</Text>
          <Controller
            control={control}
            name="maxDaysAhead"
            render={({ field }) => (
              <ChipChoice options={MAX_DAYS} value={field.value} onChange={field.onChange} format={(d) => `${d} days`} />
            )}
          />
        </View>
        <View className="gap-2">
          <Text className="text-[13px] font-bold text-label">{p.cancelCutoff}</Text>
          <Controller
            control={control}
            name="cancelCutoffMin"
            render={({ field }) => (
              <ChipChoice options={CANCEL_CUTOFF} value={field.value} onChange={field.onChange} format={leadTime} />
            )}
          />
        </View>
      </Card>
    </StackScreen>
  );
}
