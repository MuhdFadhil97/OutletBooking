import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  acceptInviteNewAccountSchema,
  normalizeMyPhone,
  type AcceptInviteNewAccount,
  type InvitationInfo,
} from '@outletbooking/shared';
import { Brand } from '@/components/Brand';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useLogout } from '@/features/auth/hooks';
import { useAcceptInvitation, useInvitation } from '@/features/staff/hooks';
import { ApiError } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { t } from '@/strings/en';

const i = t.invite;

/** Public page a staff member opens from the owner's invite link. */
export default function InviteScreen() {
  const { token = '' } = useLocalSearchParams<{ token: string }>();
  const invitation = useInvitation(token);
  const session = authClient.useSession();

  if (invitation.isPending || session.isPending) return <LoadingState label={i.loading} />;
  if (invitation.error) {
    const notFound = invitation.error instanceof ApiError && [400, 404].includes(invitation.error.status);
    return notFound ? <Message text={i.notFound} /> : <ErrorState error={invitation.error} onRetry={() => void invitation.refetch()} />;
  }
  const info = invitation.data;
  if (info.status === 'expired') return <Message text={i.expired} />;
  if (info.status === 'accepted') return <Message text={i.accepted} />;

  const sessionEmail = session.data?.user.email ?? null;
  return (
    <SafeAreaView className="flex-1 bg-bg">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerClassName="flex-grow gap-5 px-5 pb-8 pt-6" keyboardShouldPersistTaps="handled">
          <Brand />
          <Card className="gap-4 p-5">
            <View className="gap-1">
              <Text className="text-[22px] font-extrabold">{i.title(info.businessName)}</Text>
              <Text className="text-[15px] text-muted">{i.body(info.email)}</Text>
              {info.resourceName ? <Text className="text-[14px] font-semibold">{i.linked(info.resourceName)}</Text> : null}
            </View>
            {sessionEmail && sessionEmail.toLowerCase() !== info.email ? (
              <WrongAccount email={sessionEmail} />
            ) : sessionEmail ? (
              <AcceptLoggedIn token={token} info={info} />
            ) : info.accountExists ? (
              <AcceptExisting token={token} info={info} />
            ) : (
              <AcceptNew token={token} info={info} />
            )}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Message({ text }: { text: string }) {
  return (
    <SafeAreaView className="flex-1 justify-center gap-5 bg-bg px-5">
      <Brand />
      <Card className="gap-4 p-5">
        <Text className="text-[15px]">{text}</Text>
        <Button title={i.goToLogin} onPress={() => router.replace('/login')} />
      </Card>
    </SafeAreaView>
  );
}

function WrongAccount({ email }: { email: string }) {
  const logout = useLogout();
  return (
    <View className="gap-3">
      <Text className="text-[14px] text-muted">{i.wrongAccount(email)}</Text>
      <Button variant="secondary" title={t.common.logout} loading={logout.isPending} onPress={() => logout.mutate()} />
    </View>
  );
}

function AcceptLoggedIn({ token, info }: { token: string; info: InvitationInfo }) {
  const accept = useAcceptInvitation(token);
  return (
    <View className="gap-3">
      <FormError message={accept.error ? errorMessage(accept.error) : null} />
      <Button
        title={i.joinAs(info.email)}
        loading={accept.isPending}
        onPress={() => accept.mutate({ kind: 'existing', email: info.email }, { onSuccess: () => router.replace('/') })}
      />
    </View>
  );
}

const passwordOnly = z.object({ password: z.string().min(1, 'Enter your password') });

function AcceptExisting({ token, info }: { token: string; info: InvitationInfo }) {
  const accept = useAcceptInvitation(token);
  const { control, handleSubmit, formState } = useForm({
    resolver: zodResolver(passwordOnly),
    defaultValues: { password: '' },
  });
  const onSubmit = handleSubmit(({ password }) =>
    accept.mutate({ kind: 'existing', email: info.email, password }, { onSuccess: () => router.replace('/') }),
  );
  const err = accept.error;
  const message = err
    ? err instanceof ApiError && [400, 401].includes(err.status) && err.code !== 'login_required'
      ? t.login.invalid
      : errorMessage(err)
    : null;
  return (
    <View className="gap-4">
      <Text className="text-[14px] text-muted">{i.existing}</Text>
      <FormError message={message} />
      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <TextField
            compact
            label={i.password2}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={formState.errors.password?.message}
            secureTextEntry
            autoComplete="current-password"
          />
        )}
      />
      <Button title={i.join} loading={accept.isPending} onPress={onSubmit} />
    </View>
  );
}

function AcceptNew({ token, info }: { token: string; info: InvitationInfo }) {
  const accept = useAcceptInvitation(token);
  const { control, handleSubmit, formState } = useForm<AcceptInviteNewAccount>({
    resolver: zodResolver(acceptInviteNewAccountSchema),
    mode: 'onTouched',
    defaultValues: { name: '', phone: '', password: '' },
  });
  const { errors } = formState;
  const onSubmit = handleSubmit((account) =>
    accept.mutate({ kind: 'new', email: info.email, account }, { onSuccess: () => router.replace('/') }),
  );
  return (
    <View className="gap-4">
      <Text className="text-[16px] font-bold">{i.newAccount}</Text>
      <FormError message={accept.error ? errorMessage(accept.error) : null} />
      <TextField compact label={t.signup.email} value={info.email} editable={false} />
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <TextField compact label={i.name} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.name?.message} autoComplete="name" />
        )}
      />
      <Controller
        control={control}
        name="phone"
        render={({ field }) => (
          <TextField
            compact
            label={i.phone}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={() => {
              field.onChange(normalizeMyPhone(field.value));
              field.onBlur();
            }}
            error={errors.phone?.message}
            hint={t.signup.phoneHint}
            keyboardType="phone-pad"
            autoComplete="tel"
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <TextField
            compact
            label={i.password}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.password?.message}
            hint={t.signup.passwordHint}
            secureTextEntry
            autoComplete="new-password"
          />
        )}
      />
      <Button title={i.join} loading={accept.isPending} onPress={onSubmit} />
    </View>
  );
}
