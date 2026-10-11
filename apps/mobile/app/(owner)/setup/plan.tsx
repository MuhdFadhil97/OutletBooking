import { useCallback, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { formatInTimeZone } from 'date-fns-tz';
import {
  EXTRA_RESOURCE_SEN,
  PAID_PLANS,
  PLAN_PRICES,
  planMonthlySen,
  SUPPORT_WHATSAPP,
  type PaidPlan,
  type PlanInfo,
} from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { whatsappUrl } from '@/features/bookings/format';
import { useMe } from '@/features/me/hooks';
import { usePlanInfo } from '@/features/plan/hooks';
import { formatRM } from '@/lib/format';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.plans;

/** E3 · Choose a plan: Starter / Business, "Best for you" from what the business uses; pay on the website (I4). */
export default function PlanScreen() {
  const info = usePlanInfo();
  const { me, refetch: refetchMe } = useMe();
  const [picked, setPicked] = useState<PaidPlan | null>(null);

  // Coming back from the website after paying: refresh the plan and the trial banner.
  useFocusEffect(
    useCallback(() => {
      void info.refetch();
      void refetchMe();
    }, [info.refetch, refetchMe]), // eslint-disable-line react-hooks/exhaustive-deps
  );

  const tz = me?.business.timezone ?? 'Asia/Kuala_Lumpur';
  const label = me?.business.resourceLabel ?? 'Resource';
  const p = info.data;
  if (!p) {
    return (
      <StackScreen title={s.title}>
        {info.error ? <ErrorState error={info.error} onRetry={() => void info.refetch()} /> : <LoadingState />}
      </StackScreen>
    );
  }

  const current = p.plan !== 'trial' && p.hasAccess ? p.plan : null;
  const plan = picked ?? current ?? p.recommended;
  const price = formatRM(planMonthlySen(plan, p.resourceCount));

  return (
    <StackScreen
      title={s.title}
      subtitle={subtitle(p, tz)}
      footer={
        <View className="gap-2.5">
          <Button title={s.continueWith(s.names[plan], price)} onPress={() => void Linking.openURL(p.payUrls[plan])} />
          <Text className="text-center text-[12px] text-muted">{s.payNote}</Text>
        </View>
      }
    >
      <Text className="text-[14px] leading-[21px] text-muted">
        {s.youHave(s.count(p.resourceCount, label), `${p.staffCount} ${s.staffWord}`)}
      </Text>

      {PAID_PLANS.map((key) => (
        <PlanCard
          key={key}
          plan={key}
          info={p}
          label={label}
          selected={key === plan}
          current={key === current}
          onPress={() => setPicked(key)}
        />
      ))}

      <Card className="flex-row items-center justify-between px-3.5 py-3">
        <Text className="flex-1 text-[14px]">{s.extra(label)}</Text>
        <Text className="text-[14px] font-bold">{s.extraPrice(formatRM(EXTRA_RESOURCE_SEN))}</Text>
      </Card>

      <Pressable
        onPress={() =>
          void Linking.openURL(`${whatsappUrl(SUPPORT_WHATSAPP)}?text=${encodeURIComponent(s.grantMessage(me?.business.name ?? ''))}`)
        }
        accessibilityRole="button"
        accessibilityHint={s.grantAsk}
        className="gap-1 rounded-card border border-[#A9C6EE] bg-info-bg px-3.5 py-3 active:opacity-80"
      >
        <Text className="text-[13px] leading-[20px] text-info-fg">{s.grant}</Text>
        <Text className="text-[13px] font-bold text-info-fg">{s.grantAsk}</Text>
      </Pressable>
    </StackScreen>
  );
}

function subtitle(p: PlanInfo, tz: string): string {
  const date = (iso: string) => formatInTimeZone(new Date(iso), tz, 'EEE, d MMM');
  if (p.plan !== 'trial' && p.hasAccess && p.currentPeriodEnd) return s.paidUntil(s.names[p.plan], date(p.currentPeriodEnd));
  if (p.status === 'trialing') return p.hasAccess ? s.trialEnds(date(p.trialEndsAt)) : s.trialEnded(date(p.trialEndsAt));
  return '';
}

function PlanCard({
  plan,
  info,
  label,
  selected,
  current,
  onPress,
}: {
  plan: PaidPlan;
  info: PlanInfo;
  label: string;
  selected: boolean;
  current: boolean;
  onPress: () => void;
}) {
  const { priceSen, resourceLimit } = PLAN_PRICES[plan];
  const over = info.resourceCount > resourceLimit;
  const features = [s.upTo(resourceLimit, label), ...s.features[plan]];
  const badge = current ? s.current : plan === info.recommended ? s.bestForYou : null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      className={`gap-2.5 rounded-card p-4 ${selected ? 'border-2 border-primary bg-soft' : 'border border-border bg-card active:bg-pressed'}`}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-[17px] font-bold">{s.names[plan]}</Text>
        {badge ? (
          <View className="h-6 justify-center rounded-full bg-primary px-2.5">
            <Text className="text-[12px] font-bold text-white">{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text>
        <Text className="text-[26px] font-extrabold">{formatRM(priceSen)}</Text>
        <Text className="text-[14px] text-muted">{s.perMonth}</Text>
      </Text>
      <View className="gap-1.5">
        {features.map((f) => (
          <View key={f} className="flex-row items-start gap-2">
            <Icon name="check" size={16} color={colors.primary} />
            <Text className="flex-1 text-[13px]">{f}</Text>
          </View>
        ))}
      </View>
      {over ? (
        <Text className="text-[13px] font-bold text-pend-fg">
          {s.yourPrice(s.count(info.resourceCount, label), formatRM(planMonthlySen(plan, info.resourceCount)))}
        </Text>
      ) : null}
    </Pressable>
  );
}
