import { View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { deleteAccountSchema, type DeleteAccountInput } from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useDeleteAccount } from '@/features/account/hooks';
import { useMe } from '@/features/me/hooks';
import { ApiError } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { t } from '@/strings/en';

const s = t.deleteAccount;

/** H6 → Delete my account and business data (owner only). Password + business name, then a final confirm. */
export default function DeleteAccountScreen() {
  const { me, isLoading, error, refetch } = useMe();
  const remove = useDeleteAccount();
  const { control, handleSubmit, formState } = useForm<DeleteAccountInput>({
    resolver: zodResolver(deleteAccountSchema),
    defaultValues: { password: '', confirmBusinessName: '' },
  });

  if (isLoading) return <LoadingState />;
  if (error || !me) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const business = me.business.name;

  const onSubmit = handleSubmit(async (values) => {
    if (!(await confirm(s.confirmTitle, s.confirmBody, s.confirmButton))) return;
    remove.mutate(values, { onSuccess: () => router.replace('/login') });
  });

  const submitError = remove.error
    ? remove.error instanceof ApiError && remove.error.code === 'invalid_password'
      ? s.wrongPassword
      : remove.error instanceof ApiError && remove.error.code === 'confirmation_mismatch'
        ? s.wrongName
        : errorMessage(remove.error)
    : null;

  return (
    <StackScreen
      title={s.title}
      footer={<Button variant="danger" title={s.submit} loading={remove.isPending} onPress={() => void onSubmit()} />}
    >
      <FormError message={submitError} />
      <Card className="gap-2 border border-danger bg-danger-tint p-4">
        <Text className="text-[15px] font-extrabold text-danger">{s.heading}</Text>
        <Text className="text-[13px] text-text">{s.body(business)}</Text>
      </Card>
      <Card className="gap-4 p-4">
        <Controller
          control={control}
          name="password"
          render={({ field }) => (
            <TextField
              label={s.password}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={formState.errors.password?.message}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
            />
          )}
        />
        <View>
          <Controller
            control={control}
            name="confirmBusinessName"
            render={({ field }) => (
              <TextField
                label={s.confirmName}
                hint={s.confirmNameHint(business)}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={formState.errors.confirmBusinessName?.message}
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}
          />
        </View>
      </Card>
    </StackScreen>
  );
}
