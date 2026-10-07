import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordFormSchema, type ChangePasswordForm } from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SwitchRow } from '@/components/ui/Rows';
import { FormError, errorMessage } from '@/components/ui/ScreenState';
import { TextField } from '@/components/ui/TextField';
import { useChangePassword } from '@/features/auth/hooks';
import { ApiError } from '@/lib/api';
import { closeWith } from '@/lib/close-with';
import { t } from '@/strings/en';

const s = t.changePassword;

/** H6 → Change password. This device stays logged in; others can be logged out. */
export default function ChangePasswordScreen() {
  const change = useChangePassword();
  const [logoutOthers, setLogoutOthers] = useState(true);
  const { control, handleSubmit, formState } = useForm<ChangePasswordForm>({
    resolver: zodResolver(changePasswordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit((v) =>
    change.mutate(
      { currentPassword: v.currentPassword, newPassword: v.newPassword, revokeOtherSessions: logoutOthers },
      { onSuccess: closeWith(t.common.saved) },
    ),
  );

  const submitError = change.error
    ? change.error instanceof ApiError && change.error.code === 'INVALID_PASSWORD'
      ? s.wrongCurrent
      : errorMessage(change.error)
    : null;

  const field = (name: keyof ChangePasswordForm, label: string, hint?: string, last?: boolean) => (
    <Controller
      control={control}
      name={name}
      render={({ field: f }) => (
        <TextField
          label={label}
          hint={hint}
          value={f.value}
          onChangeText={f.onChange}
          onBlur={f.onBlur}
          error={formState.errors[name]?.message}
          secureTextEntry
          autoComplete={name === 'currentPassword' ? 'current-password' : 'new-password'}
          textContentType={name === 'currentPassword' ? 'password' : 'newPassword'}
          {...(last ? { onSubmitEditing: onSubmit, returnKeyType: 'go' as const } : {})}
        />
      )}
    />
  );

  return (
    <StackScreen title={s.title} footer={<Button title={s.submit} loading={change.isPending} onPress={onSubmit} />}>
      <FormError message={submitError} />
      <Card className="gap-4 p-4">
        {field('currentPassword', s.current)}
        {field('newPassword', s.newPassword, s.minLength)}
        {field('confirmPassword', s.confirmPassword, undefined, true)}
        <SwitchRow label={s.logoutOthers} hint={s.logoutOthersHint} value={logoutOthers} onChange={setLogoutOthers} />
      </Card>
    </StackScreen>
  );
}
