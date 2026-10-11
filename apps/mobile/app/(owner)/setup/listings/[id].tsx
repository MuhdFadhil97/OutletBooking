import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LISTING_STATUSES, listingCreateSchema, type Listing, type ListingCreateInput, type Resource } from '@outletbooking/shared';
import { HeaderIconButton, StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { SwitchRow } from '@/components/ui/Rows';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useDeleteListing, useListing, useSaveListing } from '@/features/listings/hooks';
import { useResources } from '@/features/setup/hooks';
import { ApiError } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { t } from '@/strings/en';

const s = t.listings;

/** ST-RE-L · add / edit one listing (`id` = "new" to add). */
export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const listing = useListing(isNew ? 0 : Number(id));
  const resources = useResources();

  if ((!isNew && !listing.data) || !resources.data) {
    const error = listing.error ?? resources.error;
    return error ? (
      <ErrorState error={error} onRetry={() => (listing.error ? router.back() : void resources.refetch())} />
    ) : (
      <LoadingState />
    );
  }
  return <ListingForm key={listing.data?.id ?? 'new'} listing={isNew ? undefined : listing.data} agents={resources.data} />;
}

function ListingForm({ listing, agents }: { listing?: Listing; agents: Resource[] }) {
  const save = useSaveListing(listing?.id ?? null);
  const remove = useDeleteListing();
  const { control, handleSubmit, formState, setError } = useForm<ListingCreateInput>({
    resolver: zodResolver(listingCreateSchema),
    mode: 'onTouched',
    defaultValues: {
      ref: listing?.ref ?? '',
      title: listing?.title ?? '',
      area: listing?.area ?? '',
      address: listing?.address ?? '',
      agentResourceId: listing?.agent?.id ?? null,
      status: listing?.status ?? 'available',
      openForViewings: listing?.openForViewings ?? true,
    },
  });
  const { errors } = formState;
  const status = useWatch({ control, name: 'status' });

  const onSave = handleSubmit((values) =>
    save.mutate(values, {
      onSuccess: () => router.back(),
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'listing_ref_taken') setError('ref', { message: err.message });
      },
    }),
  );

  const onDelete = async () => {
    if (!listing) return;
    if (await confirm(s.deleteTitle, s.deleteBody, t.setup.delete)) {
      remove.mutate(listing.id, { onSuccess: () => router.back() });
    }
  };

  const formError =
    remove.error ?? (save.error && !(save.error instanceof ApiError && save.error.code === 'listing_ref_taken') ? save.error : null);

  return (
    <StackScreen
      title={listing ? s.editTitle : s.newTitle}
      backHref="/setup/listings"
      right={listing ? <HeaderIconButton icon="trash" label={t.setup.delete} onPress={() => void onDelete()} danger /> : undefined}
      footer={<Button title={s.save} loading={save.isPending} onPress={() => void onSave()} />}
    >
      <FormError message={formError ? errorMessage(formError) : null} />

      <Controller
        control={control}
        name="title"
        render={({ field }) => (
          <TextField
            compact
            label={s.titleLabel}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.title?.message}
            placeholder={s.titlePlaceholder}
          />
        )}
      />
      <Controller
        control={control}
        name="ref"
        render={({ field }) => (
          <TextField
            compact
            label={s.ref}
            value={field.value}
            onChangeText={(v) => field.onChange(v.toUpperCase())}
            onBlur={field.onBlur}
            error={errors.ref?.message}
            hint={s.refHint}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        )}
      />
      <Controller
        control={control}
        name="area"
        render={({ field }) => (
          <TextField
            compact
            label={s.area}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.area?.message}
            placeholder={s.areaPlaceholder}
          />
        )}
      />
      <Controller
        control={control}
        name="address"
        render={({ field }) => (
          <TextField
            compact
            label={s.address}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.address?.message}
            hint={s.addressHint}
            multiline
          />
        )}
      />

      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{s.agent}</Text>
        <Controller
          control={control}
          name="agentResourceId"
          render={({ field }) => (
            <View className="flex-row flex-wrap gap-2">
              <Chip role="radio" label={s.noAgent} selected={field.value == null} onPress={() => field.onChange(null)} />
              {agents
                .filter((a) => a.isActive || a.id === field.value)
                .map((a) => (
                  <Chip key={a.id} role="radio" label={a.name} selected={field.value === a.id} onPress={() => field.onChange(a.id)} />
                ))}
            </View>
          )}
        />
      </View>

      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{s.statusLabel}</Text>
        <Controller
          control={control}
          name="status"
          render={({ field }) => (
            <View className="flex-row flex-wrap gap-2">
              {LISTING_STATUSES.map((st) => (
                <Chip key={st} role="radio" label={s.status[st]} selected={field.value === st} onPress={() => field.onChange(st)} />
              ))}
            </View>
          )}
        />
      </View>

      <Card className="px-4 py-2">
        {status === 'closed' ? (
          <Text className="py-3 text-[13px] text-muted">{s.closedNote}</Text>
        ) : (
          <Controller
            control={control}
            name="openForViewings"
            render={({ field }) => (
              <SwitchRow label={s.openLabel} hint={s.openHint} value={field.value ?? true} onChange={field.onChange} />
            )}
          />
        )}
      </Card>
    </StackScreen>
  );
}
