import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { changePhoneSchema, normalizeMyPhone, type ChangePhoneInput } from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useChangePhone } from '@/features/account/hooks';
import { formatPhone } from '@/features/bookings/format';
import { useMe } from '@/features/me/hooks';
import { ApiError } from '@/lib/api';
import { t } from '@/strings/en';

const s = t.changeMobile;

/** H6 → Change mobile. Password re-typed; no SMS code. */
export default function ChangePhoneScreen() {
  const { me, isLoading, error, refetch } = useMe();
  const change = useChangePhone();
  const { control, handleSubmit, formState } = useForm<ChangePhoneInput>({
    resolver: zodResolver(changePhoneSchema),
    defaultValues: { phone: '', currentPassword: '' },
  });

  if (isLoading) return <LoadingState />;
  if (error || !me) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const onSubmit = handleSubmit((v) => change.mutate(v, { onSuccess: () => router.back() }));
  const submitError = change.error
    ? change.error instanceof ApiError && change.error.code === 'invalid_password'
      ? s.wrongPassword
      : errorMessage(change.error)
    : null;

  return (
    <StackScreen title={s.title} footer={<Button title={s.submit} loading={change.isPending} onPress={onSubmit} />}>
      <FormError message={submitError} />
      <Card className="gap-4 p-4">
        <Text className="text-[14px] text-muted">{s.intro}</Text>
        <Text className="text-[13px] text-muted">
          {s.current}: {me.user.phone ? formatPhone(me.user.phone) : t.account.noMobile}
        </Text>
        <Controller
          control={control}
          name="phone"
          render={({ field: f }) => (
            <TextField
              label={s.newMobile}
              hint={t.signup.phoneHint}
              value={f.value}
              onChangeText={f.onChange}
              onBlur={() => {
                if (f.value) f.onChange(normalizeMyPhone(f.value));
                f.onBlur();
              }}
              error={formState.errors.phone?.message}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
            />
          )}
        />
        <Controller
          control={control}
          name="currentPassword"
          render={({ field: f }) => (
            <TextField
              label={s.password}
              hint={s.passwordHint}
              value={f.value}
              onChangeText={f.onChange}
              onBlur={f.onBlur}
              error={formState.errors.currentPassword?.message}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              onSubmitEditing={onSubmit}
              returnKeyType="go"
            />
          )}
        />
      </Card>
    </StackScreen>
  );
}
