import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { Service, ServiceUpdate } from '@outletbooking/shared';
import { Brand } from '@/components/Brand';
import { RoleGate } from '@/components/RoleGate';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChipChoice } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { MoneyField } from '@/components/ui/MoneyField';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { clearOnboardingPending } from '@/features/auth/onboarding';
import { useServices, useUpdateServices } from '@/features/setup/hooks';
import { formatDuration } from '@/lib/format';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.signup;
const DURATIONS = [15, 30, 45, 60, 90, 120] as const;

/** Sign-up step 3 of 3 (PRD onboarding: "Review pre-filled services → edit price/duration"). */
export default function WelcomeScreen() {
  return (
    <RoleGate role="owner" allowOnboarding>
      <ReviewServices />
    </RoleGate>
  );
}

type Edit = { priceSen: number; durationMin: number };

function ReviewServices() {
  const services = useServices();
  const save = useUpdateServices();
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [error, setError] = useState<string | null>(null);

  // Cleared only when the owner finishes or skips: until then every owner screen sends them back here.
  const done = () => {
    clearOnboardingPending();
    router.replace('/today');
  };

  if (!services.data) {
    return (
      <Frame>
        {services.error ? <ErrorState error={services.error} onRetry={() => void services.refetch()} /> : <LoadingState />}
      </Frame>
    );
  }

  const value = (svc: Service): Edit => edits[svc.id] ?? { priceSen: svc.priceSen, durationMin: svc.durationMin };
  const change = (svc: Service, patch: Partial<Edit>) => setEdits((e) => ({ ...e, [svc.id]: { ...value(svc), ...patch } }));

  const finish = () => {
    const changed = services.data
      .map((svc) => ({ svc, v: value(svc) }))
      .filter(({ svc, v }) => v.priceSen !== svc.priceSen || v.durationMin !== svc.durationMin);
    if (changed.some(({ v }) => !Number.isInteger(v.priceSen) || v.priceSen < 0)) return setError(s.priceInvalid);
    setError(null);
    if (!changed.length) return done();
    const body = ({ svc, v }: (typeof changed)[number]): ServiceUpdate => ({
      priceSen: v.priceSen,
      // Services with customer-chosen lengths keep their duration (options are multiples of it).
      ...(svc.durationOptions?.length ? {} : { durationMin: v.durationMin }),
    });
    save.mutate(changed.map((c) => ({ id: c.svc.id, body: body(c) })), { onSuccess: done });
  };

  return (
    <Frame
      footer={
        <View className="gap-2">
          <Button title={s.finish} loading={save.isPending} onPress={finish} />
          <Button title={s.skip} variant="secondary" disabled={save.isPending} onPress={done} />
        </View>
      }
    >
      <Text className="text-[14px] text-muted">{s.servicesBody}</Text>
      <FormError message={error ?? (save.error ? errorMessage(save.error) : null)} />

      {services.data.length === 0 ? (
        <Card className="p-4">
          <Text className="text-[14px] text-muted">{s.servicesEmpty}</Text>
        </Card>
      ) : (
        services.data.map((svc) => {
          const v = value(svc);
          const options = svc.durationOptions?.length ? svc.durationOptions : null;
          return (
            <Card key={svc.id} className="gap-3 p-3.5">
              <Text className="text-[16px] font-extrabold">{svc.name}</Text>
              <View className="gap-2">
                <Text className="text-[13px] font-bold text-label">{s.durationLabel}</Text>
                {options ? (
                  <Text className="text-[14px] text-muted">{s.durationsFixed(options.map(formatDuration).join(' / '))}</Text>
                ) : (
                  <ChipChoice options={DURATIONS} value={v.durationMin} onChange={(d) => change(svc, { durationMin: d })} format={formatDuration} />
                )}
              </View>
              <MoneyField
                label={svc.priceUnit === 'per_block' ? s.pricePerBlock(formatDuration(svc.durationMin)) : s.priceLabel}
                valueSen={v.priceSen}
                onChangeSen={(sen) => change(svc, { priceSen: sen })}
              />
            </Card>
          );
        })
      )}

      <View className="flex-row items-center gap-2 rounded-input bg-primary-tint px-3.5 py-3">
        <Icon name="settings" size={18} color={colors['ok-fg']} />
        <Text className="flex-1 text-[13px] font-semibold text-ok-fg">{s.nextUp}</Text>
      </View>
    </Frame>
  );
}

function Frame({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="flex-grow gap-4 px-5 pb-6 pt-6" keyboardShouldPersistTaps="handled">
        <Brand step={{ current: 3, total: 3, label: s.step(3) }} />
        <Text className="text-[22px] font-extrabold">{s.servicesTitle}</Text>
        {children}
      </ScrollView>
      {footer ? <View className="border-t border-border bg-card px-5 pb-3 pt-3">{footer}</View> : null}
    </SafeAreaView>
  );
}
