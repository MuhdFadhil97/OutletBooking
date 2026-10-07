import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@outletbooking/shared';
import { Brand } from '@/components/Brand';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { FormError, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useForgotPassword } from '@/features/auth/hooks';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.forgot;

/** E1 · Forgot password: email → reset link (30 min) → E2. */
export default function ForgotPasswordScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const forgot = useForgotPassword();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sentAgain, setSentAgain] = useState(false);
  const { control, handleSubmit, formState } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: params.email ?? '' },
  });

  const onSubmit = handleSubmit((values) =>
    forgot.mutate(values, {
      onSuccess: () => {
        setSentAgain(false);
        setSentTo(values.email);
      },
    }),
  );
  const sendAgain = () => {
    if (!sentTo) return;
    forgot.mutate({ email: sentTo }, { onSuccess: () => setSentAgain(true) });
  };
  const back = () => (router.canGoBack() ? router.back() : router.replace('/login'));

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerClassName="flex-grow gap-6 px-5 pb-8 pt-3" keyboardShouldPersistTaps="handled">
          <View className="flex-row items-center gap-3">
            <Pressable
              onPress={back}
              accessibilityRole="button"
              accessibilityLabel={t.common.back}
              className="h-11 w-11 items-center justify-center rounded-button border border-border bg-card active:bg-pressed"
            >
              <Icon name="chevron-left" color={colors.text} />
            </Pressable>
            <Text className="text-[17px] font-bold">{s.screen}</Text>
          </View>
          <Brand />

          <Card className="gap-4 p-5">
            <Text className="text-[22px] font-extrabold">{s.title}</Text>
            {sentTo ? (
              <View className="gap-3">
                <View className="flex-row gap-3 rounded-card bg-soft p-3.5" accessibilityRole="alert">
                  <Icon name="mail" color={colors.primary} />
                  <View className="flex-1 gap-1">
                    <Text className="text-[15px] font-bold">{s.sentTitle}</Text>
                    <Text className="text-[14px] text-muted">{s.sentBody(sentTo)}</Text>
                  </View>
                </View>
                <Text className="text-[14px] text-muted">
                  {s.sentHint}{' '}
                  <Text className="text-[14px] font-bold text-primary" onPress={forgot.isPending ? undefined : sendAgain} accessibilityRole="link">
                    {s.sendAgain}
                  </Text>
                  .
                </Text>
                {sentAgain ? <Text className="text-[13px] font-semibold text-primary">{s.sentAgain}</Text> : null}
                <FormError message={forgot.error ? errorMessage(forgot.error) : null} />
              </View>
            ) : (
              <>
                <Text className="text-[15px] text-muted">{s.body}</Text>
                <FormError message={forgot.error ? errorMessage(forgot.error) : null} />
                <Controller
                  control={control}
                  name="email"
                  render={({ field }) => (
                    <TextField
                      label={s.email}
                      value={field.value}
                      onChangeText={field.onChange}
                      onBlur={field.onBlur}
                      error={formState.errors.email?.message}
                      autoCapitalize="none"
                      autoComplete="email"
                      keyboardType="email-address"
                      textContentType="emailAddress"
                      onSubmitEditing={onSubmit}
                      returnKeyType="send"
                    />
                  )}
                />
                <Button title={s.submit} loading={forgot.isPending} onPress={onSubmit} />
              </>
            )}
          </Card>

          <Button variant="secondary" title={s.backToLogin} onPress={() => router.replace('/login')} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
