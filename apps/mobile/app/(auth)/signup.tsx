import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  normalizeMyPhone,
  signupSchema,
  suggestSlug,
  type BusinessTemplate,
  type SignupInput,
} from '@outletbooking/shared';
import { Brand } from '@/components/Brand';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { FormError, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useSignup, useSlugAvailability } from '@/features/auth/hooks';
import { ApiError } from '@/lib/api';
import { PUBLIC_BOOKING_BASE } from '@/lib/config';
import { t } from '@/strings/en';
import { colors } from '@/theme';

/** Template grid on the sign-up screen (clinic/tuition live under "Other" for now). */
const TEMPLATE_CHOICES: { value: BusinessTemplate; icon: IconName }[] = [
  { value: 'real_estate', icon: 'building' },
  { value: 'vehicle_inspection', icon: 'car' },
  { value: 'sports', icon: 'court' },
  { value: 'workshop', icon: 'wrench' },
  { value: 'barber_salon', icon: 'scissors' },
  { value: 'other', icon: 'grid' },
];

const STEP1_FIELDS = ['name', 'email', 'phone', 'password'] as const;
const linkPrefix = `${PUBLIC_BOOKING_BASE.replace(/^https?:\/\//, '')}/book/`;

/** O1 · Sign-up: step 1 account, step 2 business + template. Step 3 (review services) is `/welcome`. */
export default function SignupScreen() {
  const [step, setStep] = useState<1 | 2>(1);
  const [slugEdited, setSlugEdited] = useState(false);
  const signup = useSignup();

  const { control, handleSubmit, formState, trigger, watch, setValue, setError, getValues } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    mode: 'onTouched',
    defaultValues: { name: '', email: '', phone: '', password: '', businessName: '', slug: '', template: 'sports' },
  });
  const { errors } = formState;

  const businessName = watch('businessName');
  const slug = watch('slug');
  useEffect(() => {
    if (!slugEdited) setValue('slug', suggestSlug(businessName));
  }, [businessName, slugEdited, setValue]);

  const slugCheck = useSlugAvailability(slug);

  const goNext = async () => {
    setValue('phone', normalizeMyPhone(getValues('phone')));
    if (await trigger(STEP1_FIELDS)) setStep(2);
  };

  const onSubmit = handleSubmit((values) => {
    if (slugCheck.data && !slugCheck.data.available) {
      setError('slug', { message: t.signup.taken });
      return;
    }
    signup.mutate(values, {
      // No navigation here: once the new session appears the (auth) layout redirects to `/`,
      // which sends the owner to step 3 (`/welcome`). Navigating here as well raced with that.
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'slug_taken') setError('slug', { message: err.message });
        if (err instanceof ApiError && err.code === 'email_taken') {
          setStep(1);
          setError('email', { message: err.message });
        }
      },
    });
  }, (invalid) => {
    if (STEP1_FIELDS.some((f) => invalid[f])) setStep(1);
  });

  const submitError =
    signup.error && !(signup.error instanceof ApiError && ['slug_taken', 'email_taken'].includes(signup.error.code))
      ? errorMessage(signup.error)
      : null;

  const slugStatus = !slug ? null : !slugCheck.valid ? (
    <Text className="text-[12px] font-bold text-danger">{t.signup.invalidSlug}</Text>
  ) : slugCheck.pending ? (
    <Text className="text-[12px] text-muted">{t.signup.checking}</Text>
  ) : slugCheck.available ? (
    <View className="flex-row items-center gap-1">
      <Icon name="check" size={14} color={colors['ok-fg']} />
      <Text className="text-[12px] font-bold text-ok-fg">{t.signup.available}</Text>
    </View>
  ) : slugCheck.data ? (
    <Text className="text-[12px] font-bold text-danger">{t.signup.taken}</Text>
  ) : null;

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerClassName="flex-grow gap-5 px-5 pb-8 pt-6" keyboardShouldPersistTaps="handled">
          <Brand step={{ current: step, total: 3, label: t.signup.step(step) }} />

          {step === 1 ? (
            <View className="gap-4">
              <Text className="text-[22px] font-extrabold">{t.signup.accountTitle}</Text>
              <Controller
                control={control}
                name="name"
                render={({ field }) => (
                  <TextField compact label={t.signup.name} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.name?.message} autoComplete="name" />
                )}
              />
              <Controller
                control={control}
                name="email"
                render={({ field }) => (
                  <TextField compact label={t.signup.email} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.email?.message} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
                )}
              />
              <Controller
                control={control}
                name="phone"
                render={({ field }) => (
                  <TextField
                    compact
                    label={t.signup.phone}
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
                  <TextField compact label={t.signup.password} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.password?.message} hint={t.signup.passwordHint} secureTextEntry autoComplete="new-password" />
                )}
              />
              <Button title={t.common.continue} onPress={() => void goNext()} />
              <View className="flex-row items-center justify-center gap-1">
                <Text className="text-[14px] text-muted">{t.signup.haveAccount}</Text>
                <Pressable onPress={() => router.replace('/login')} className="min-h-[44px] justify-center px-1">
                  <Text className="text-[14px] font-bold text-primary">{t.signup.login}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View className="gap-4">
              <Text className="text-[22px] font-extrabold">{t.signup.businessTitle}</Text>
              <FormError message={submitError} />
              <Controller
                control={control}
                name="businessName"
                render={({ field }) => (
                  <TextField compact label={t.signup.businessName} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.businessName?.message} autoCapitalize="words" />
                )}
              />
              <Controller
                control={control}
                name="slug"
                render={({ field }) => (
                  <TextField
                    compact
                    label={t.signup.bookingLink}
                    prefix={linkPrefix}
                    value={field.value}
                    onChangeText={(v) => {
                      setSlugEdited(true);
                      field.onChange(v.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                    }}
                    onBlur={field.onBlur}
                    error={errors.slug?.message}
                    autoCapitalize="none"
                    autoCorrect={false}
                    right={slugStatus}
                  />
                )}
              />

              <Text className="text-[13px] font-bold text-label">{t.signup.kind}</Text>
              <Controller
                control={control}
                name="template"
                render={({ field }) => (
                  <View className="flex-row flex-wrap gap-2.5">
                    {TEMPLATE_CHOICES.map(({ value, icon }) => {
                      const on = field.value === value;
                      const copy = t.templates[value as keyof typeof t.templates];
                      return (
                        <Pressable
                          key={value}
                          onPress={() => field.onChange(value)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                          className={`min-h-[88px] basis-[48%] grow gap-1.5 rounded-button p-3 ${
                            on ? 'border-2 border-primary bg-soft' : 'border border-input-border bg-card'
                          }`}
                        >
                          <Icon name={icon} color={on ? colors.primary : colors.text} />
                          <Text className="text-[14px] font-bold">{copy.title}</Text>
                          <Text className="text-[12px] text-muted">{copy.sub}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              />

              <View className="flex-row items-center gap-2 rounded-input bg-primary-tint px-3.5 py-3">
                <Icon name="clock" size={18} color={colors['ok-fg']} />
                <Text className="text-[14px] font-bold text-ok-fg">{t.signup.trialNote}</Text>
              </View>

              <Button title={t.common.continue} loading={signup.isPending} onPress={onSubmit} />
              <Button variant="secondary" title={t.common.back} onPress={() => setStep(1)} disabled={signup.isPending} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
