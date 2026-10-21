import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { changeEmailSchema, type ChangeEmailInput } from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useRequestEmailChange } from '@/features/account/hooks';
import { useMe } from '@/features/me/hooks';
import { ApiError } from '@/lib/api';
import { t } from '@/strings/en';

const s = t.changeEmail;

const CODE_MESSAGES: Record<string, string> = {
  invalid_password: s.wrongPassword,
  email_taken: s.taken,
  same_email: s.same,
};

/** H6 → Change email. The login only switches after the new address opens the emailed link. */
export default function ChangeEmailScreen() {
  const { me, isLoading, error, refetch } = useMe();
  const change = useRequestEmailChange();
  const { control, handleSubmit, formState } = useForm<ChangeEmailInput>({
    resolver: zodResolver(changeEmailSchema),
    defaultValues: { email: '', currentPassword: '' },
  });

  if (isLoading) return <LoadingState />;
  if (error || !me) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const onSubmit = handleSubmit((v) => change.mutate(v));
  const submitError = change.error
    ? (change.error instanceof ApiError ? CODE_MESSAGES[change.error.code] : undefined) ?? errorMessage(change.error)
    : null;

  if (change.isSuccess) {
    return (
      <StackScreen title={s.title} footer={<Button title={s.done} onPress={() => router.back()} />}>
        <Card className="gap-2 p-4">
          <Text className="text-[17px] font-extrabold">{s.sentTitle}</Text>
          <Text className="text-[15px] text-muted">{s.sentBody(change.variables.email)}</Text>
        </Card>
      </StackScreen>
    );
  }

  return (
    <StackScreen title={s.title} footer={<Button title={s.submit} loading={change.isPending} onPress={onSubmit} />}>
      <FormError message={submitError} />
      <Card className="gap-4 p-4">
        <Text className="text-[14px] text-muted">{s.intro}</Text>
        <Text className="text-[13px] text-muted">
          {s.current}: {me.user.email}
        </Text>
        <Controller
          control={control}
          name="email"
          render={({ field: f }) => (
            <TextField
              label={s.newEmail}
              value={f.value}
              onChangeText={f.onChange}
              onBlur={f.onBlur}
              error={formState.errors.email?.message}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
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
