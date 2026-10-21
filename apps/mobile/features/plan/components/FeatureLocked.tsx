import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { PlanFeature } from '@outletbooking/shared';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useMe } from '@/features/me/hooks';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.planLocked;

/** A screen the current plan does not include (Starter): says so and points to the plan screen (E3). */
export function FeatureLocked({ what }: { what: string }) {
  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="grow justify-center gap-3.5 p-6">
        <View className="h-[72px] w-[72px] items-center justify-center self-center rounded-full bg-pend-bg">
          <Icon name="lock" size={32} color={colors['pend-fg']} />
        </View>
        <Text className="text-center text-[22px] font-extrabold" accessibilityRole="header">
          {s.title(what)}
        </Text>
        <Text className="text-center text-[15px] leading-[22px] text-muted">{s.body}</Text>
        <View className="h-2" />
        <Button title={s.upgrade} onPress={() => router.push('/setup/plan')} />
        {router.canGoBack() ? <Button variant="secondary" title={s.back} onPress={() => router.back()} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Shows `children` only when the plan has the feature (the free trial has all). The children mount after the
 * check, so a locked screen never makes the API calls the plan would refuse.
 */
export function FeatureGate({ feature, what, children }: { feature: PlanFeature; what: string; children: ReactNode }) {
  const { me } = useMe();
  if (me && !me.subscription.features[feature]) return <FeatureLocked what={what} />;
  return <>{children}</>;
}
