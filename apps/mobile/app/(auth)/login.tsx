import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@outletbooking/shared';
import { Brand } from '@/components/Brand';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { FormError, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useLogin } from '@/features/auth/hooks';
import { ApiError } from '@/lib/api';
import { t } from '@/strings/en';

/** O0 · Log in (owner & staff) */
export default function LoginScreen() {
  const [remember, setRemember] = useState(true);
  const login = useLogin();
  const { control, handleSubmit, formState } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit((values) =>
    login.mutate({ ...values, rememberMe: remember }, { onSuccess: () => router.replace('/') }),
  );

  const submitError = login.error
    ? login.error instanceof ApiError && [400, 401].includes(login.error.status)
      ? t.login.invalid
      : errorMessage(login.error)
    : null;

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerClassName="flex-grow gap-6 px-5 pb-8 pt-6" keyboardShouldPersistTaps="handled">
          <View className="gap-3">
            <Brand />
            <Text className="text-[15px] text-muted">{t.tagline}</Text>
          </View>

          <Card className="gap-4 p-5">
            <Text className="text-[22px] font-extrabold">{t.login.title}</Text>
            <FormError message={submitError} />
            <Controller
              control={control}
              name="email"
              render={({ field }) => (
                <TextField
                  label={t.login.email}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={formState.errors.email?.message}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                />
              )}
            />
            <Controller
              control={control}
              name="password"
              render={({ field }) => (
                <TextField
                  label={t.login.password}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={formState.errors.password?.message}
                  secureTextEntry
                  autoComplete="password"
                  textContentType="password"
                  onSubmitEditing={onSubmit}
                  returnKeyType="go"
                />
              )}
            />

            <View className="flex-row items-center justify-between">
              <Pressable
                onPress={() => setRemember((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: remember }}
                className="min-h-[44px] flex-row items-center gap-2"
              >
                <View
                  className={`h-5 w-5 items-center justify-center rounded-[5px] border ${
                    remember ? 'border-primary bg-primary' : 'border-input-border bg-card'
                  }`}
                >
                  {remember ? <Icon name="check" size={14} color="#FFFFFF" /> : null}
                </View>
                <Text className="text-[14px]">{t.login.keepLoggedIn}</Text>
              </Pressable>
              <Link href="/forgot-password" className="min-h-[44px] py-3">
                <Text className="text-[14px] font-bold text-primary">{t.login.forgot}</Text>
              </Link>
            </View>

            <Button title={t.login.submit} loading={login.isPending} onPress={onSubmit} />
            <Text className="text-[13px] text-muted">{t.login.staffNote}</Text>
          </Card>

          <View className="items-center gap-3">
            <Text className="text-[14px] text-muted">{t.login.newHere}</Text>
            <Button variant="secondary" title={t.login.startTrial} onPress={() => router.push('/signup')} className="self-stretch" />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
