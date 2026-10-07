import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  businessDetailsSchema,
  normalizeMyPhone,
  type BusinessDetailsInput,
  type BusinessProfile,
} from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useBusiness, useUpdateBusiness } from '@/features/setup/hooks';
import { ApiError } from '@/lib/api';
import { PUBLIC_BOOKING_BASE } from '@/lib/config';
import { t } from '@/strings/en';

const p = t.setup.profile;
const linkPrefix = `${PUBLIC_BOOKING_BASE.replace(/^https?:\/\//, '')}/book/`;

function toForm(b: BusinessProfile): BusinessDetailsInput {
  return {
    name: b.name,
    slug: b.slug,
    phone: b.phone ?? '',
    whatsappPhone: b.whatsappPhone ?? '',
    email: b.email ?? '',
    address: b.address ?? '',
    description: b.description ?? '',
    resourceLabel: b.resourceLabel,
  };
}

/** E5 · Business profile: name, booking link, contact details, about, what customers book. */
export default function ProfileScreen() {
  const business = useBusiness();
  if (business.isPending) return <LoadingState />;
  if (business.error) return <ErrorState error={business.error} onRetry={() => void business.refetch()} />;
  return <ProfileForm business={business.data} />;
}

function ProfileForm({ business }: { business: BusinessProfile }) {
  const save = useUpdateBusiness();
  const { control, handleSubmit, formState, reset, setError } = useForm({
    resolver: zodResolver(businessDetailsSchema),
    mode: 'onTouched',
    defaultValues: toForm(business),
  });
  const { errors, isDirty } = formState;

  useEffect(() => reset(toForm(business)), [business, reset]);

  const onSave = handleSubmit((values) =>
    save.mutate(values, {
      onSuccess: () => router.back(),
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'slug_taken') setError('slug', { message: p.slugTaken });
      },
    }),
  );

  const text = (
    name: 'name' | 'address' | 'description' | 'resourceLabel' | 'email' | 'slug',
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

  const slugTaken = save.error instanceof ApiError && save.error.code === 'slug_taken';
  const typeName = t.templates[business.template as keyof typeof t.templates]?.title ?? business.template;

  return (
    <StackScreen
      title={p.title}
      footer={<Button title={p.saveProfile} loading={save.isPending} disabled={!isDirty} onPress={onSave} />}
    >
      <FormError message={save.error && !slugTaken ? errorMessage(save.error) : null} />
      <Card className="gap-4 p-4">
        {text('name', p.name, { autoCapitalize: 'words' })}
        <View className="gap-1">
          {text('slug', p.bookingLink, {
            autoCapitalize: 'none',
            autoCorrect: false,
            hint: `${linkPrefix}… · ${p.bookingLinkHint}`,
          })}
        </View>
        {phone('phone', p.phone)}
        {phone('whatsappPhone', p.whatsapp, p.whatsappHint)}
        {text('email', p.email, { autoCapitalize: 'none', keyboardType: 'email-address' })}
        {text('address', p.address, { multiline: true })}
        {text('description', p.description, { multiline: true, hint: p.descriptionHint })}
        {text('resourceLabel', p.resourceLabel, { hint: p.resourceLabelHint, autoCapitalize: 'words' })}
      </Card>
      <Card className="gap-1 p-4">
        <Text className="text-[13px] font-bold text-label">{p.businessType}</Text>
        <Text className="text-[15px] font-bold">{typeName}</Text>
        <Text className="text-[12px] text-muted">{p.businessTypeHint}</Text>
      </Card>
    </StackScreen>
  );
}
