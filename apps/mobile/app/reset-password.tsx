import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordFormSchema, type ResetPasswordForm } from '@outletbooking/shared';
import { Brand } from '@/components/Brand';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { SwitchRow } from '@/components/ui/Rows';
import { FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useResetPassword, useResetTokenInfo } from '@/features/auth/hooks';
import { ApiError } from '@/lib/api';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.reset;

/**
 * E2 · Set new password, opened from the emailed link (`/reset-password?token=…`).
 * Lives outside (auth) so the link works even if someone is logged in on this device.
 */
export default function ResetPasswordScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const info = useResetTokenInfo(token);
  const reset = useResetPassword();
  const [logoutOthers, setLogoutOthers] = useState(true);
  const { control, handleSubmit, formState } = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });
  const [newPassword, confirmPassword] = useWatch({ control, name: ['newPassword', 'confirmPassword'] });

  const onSubmit = handleSubmit((values) =>
    reset.mutate(
      { token: token!, newPassword: values.newPassword, logoutOtherDevices: logoutOthers },
      { onSuccess: () => router.replace('/') },
    ),
  );

  const linkInvalid =
    !token ||
    (info.error instanceof ApiError && [400, 404].includes(info.error.status)) ||
    (reset.error instanceof ApiError && reset.error.code === 'invalid_reset_link');

  let body;
  if (linkInvalid) {
    body = (
      <Card className="gap-4 p-5">
        <Text className="text-[22px] font-extrabold">{s.invalidTitle}</Text>
        <Text className="text-[15px] text-muted">{s.invalidBody}</Text>
        <Button title={s.newLink} onPress={() => router.replace('/forgot-password')} />
      </Card>
    );
  } else if (info.isPending) {
    body = <LoadingState />;
  } else if (info.error) {
    body = (
      <Card className="gap-4 p-5">
        <FormError message={errorMessage(info.error)} />
        <Button variant="secondary" title={t.common.retry} onPress={() => void info.refetch()} />
      </Card>
    );
  } else {
    const longEnough = newPassword.length >= 8;
    const matches = longEnough && newPassword === confirmPassword;
    body = (
      <Card className="gap-4 p-5">
        <View className="gap-1">
          <Text className="text-[22px] font-extrabold">{s.title}</Text>
          <Text className="text-[14px] text-muted">{s.forEmail(info.data.email)}</Text>
        </View>
        <FormError message={reset.error ? errorMessage(reset.error) : null} />
        <Controller
          control={control}
          name="newPassword"
          render={({ field }) => (
            <TextField
              label={s.newPassword}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={formState.errors.newPassword?.message}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
            />
          )}
        />
        <Controller
          control={control}
          name="confirmPassword"
          render={({ field }) => (
            <TextField
              label={s.confirmPassword}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={formState.errors.confirmPassword?.message}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              onSubmitEditing={onSubmit}
              returnKeyType="go"
            />
          )}
        />
        <View className="gap-1">
          <Requirement met={longEnough} label={s.minLength} />
          <Requirement met={matches} label={s.match} />
        </View>
        <SwitchRow label={s.logoutOthers} hint={s.logoutOthersHint} value={logoutOthers} onChange={setLogoutOthers} />
        <Button title={s.submit} loading={reset.isPending} onPress={onSubmit} />
      </Card>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerClassName="flex-grow gap-6 px-5 pb-8 pt-6" keyboardShouldPersistTaps="handled">
          <View className="gap-1">
            <Brand />
            <Text className="text-[15px] font-semibold text-muted">{s.screen}</Text>
          </View>
          {body}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Requirement({ met, label }: { met: boolean; label: string }) {
  return (
    <View className="flex-row items-center gap-2">
      <Icon name={met ? 'check' : 'x'} size={16} color={met ? colors.primary : colors.muted} />
      <Text className={`text-[13px] ${met ? 'font-semibold text-primary' : 'text-muted'}`}>{label}</Text>
    </View>
  );
}
