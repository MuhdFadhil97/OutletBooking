import { useCallback, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { formatInTimeZone } from 'date-fns-tz';
import {
  DEFAULT_PLANS,
  PLAN_FEATURES,
  planEntryMonthlySen,
  type PaidPlan,
  type PlanCatalogEntry,
  type PlanInfo,
} from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { useMe } from '@/features/me/hooks';
import { getWebBillingLink } from '@/features/plan/api';
import { usePlanInfo } from '@/features/plan/hooks';
import { ApiError } from '@/lib/api';
import { formatRM } from '@/lib/format';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.plans;

/** E3 · Choose a plan: Starter / Business, "Best for you" from what the business uses; pay on the website (I4). */
export default function PlanScreen() {
  const info = usePlanInfo();
  const { me, refetch: refetchMe } = useMe();
  const [picked, setPicked] = useState<PaidPlan | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

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

  /**
   * Opens the website already signed in. The pay page falls back to the plain link if the call fails (the website
   * then asks for an email link); Billing & receipts has no plain link, so it shows the error.
   */
  async function openWebsite(target: { plan: PaidPlan; fallbackUrl: string } | { plan?: undefined; fallbackUrl?: undefined }) {
    setOpening(true);
    setOpenError(null);
    try {
      const { url } = await getWebBillingLink(target.plan ? { plan: target.plan, page: 'pay' } : { page: 'account' });
      await Linking.openURL(url);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'email_not_confirmed') setOpenError(err.message);
      else if (target.fallbackUrl) await Linking.openURL(target.fallbackUrl);
      else setOpenError(s.billingOpenError);
    } finally {
      setOpening(false);
    }
  }

  const current = p.plan !== 'trial' && p.hasAccess ? p.plan : null;
  // Prices and limits are set by FTech (admin I12). A plan hidden from the website is only shown to its own customers.
  const catalog = p.plans ?? DEFAULT_PLANS;
  const shown = catalog.filter((c) => c.isPublic || c.code === current);
  const entry = shown.find((c) => c.code === (picked ?? current ?? p.recommended)) ?? shown[0] ?? DEFAULT_PLANS[0]!;
  const plan = entry.code;
  const price = formatRM(planEntryMonthlySen(entry, p.resourceCount));

  return (
    <StackScreen
      title={s.title}
      subtitle={subtitle(p, tz)}
      footer={
        <View className="gap-2.5">
          {openError ? <Text className="text-center text-[13px] text-danger">{openError}</Text> : null}
          <Button title={s.continueWith(s.names[plan], price)} loading={opening} onPress={() => void openWebsite({ plan, fallbackUrl: p.payUrls[plan] })} />
          <Button title={s.billingReceipts} variant="secondary" disabled={opening} onPress={() => void openWebsite({})} />
          <Text className="text-center text-[12px] text-muted">{s.payNote}</Text>
          <Text className="text-center text-[12px] text-muted">{s.billingNote}</Text>
        </View>
      }
    >
      <Text className="text-[14px] leading-[21px] text-muted">
        {s.youHave(s.count(p.resourceCount, label), `${p.staffCount} ${s.staffWord}`)}
      </Text>

      {shown.map((c) => (
        <PlanCard
          key={c.code}
          entry={c}
          info={p}
          label={label}
          selected={c.code === plan}
          current={c.code === current}
          onPress={() => setPicked(c.code)}
        />
      ))}

      <Card className="flex-row items-center justify-between px-3.5 py-3">
        <Text className="flex-1 text-[14px]">{s.extra(label)}</Text>
        <Text className="text-[14px] font-bold">{s.extraPrice(formatRM(entry.extraResourceSen))}</Text>
      </Card>

      <Text className="text-[13px] font-bold text-primary" onPress={() => router.push('/refund')} accessibilityRole="link">
        {t.legal.refundRow}
      </Text>
    </StackScreen>
  );
}

function subtitle(p: PlanInfo, tz: string): string {
  const date = (iso: string) => formatInTimeZone(new Date(iso), tz, 'EEE, d MMM');
  if (p.plan !== 'trial' && p.hasAccess && p.freeUntil && new Date(p.freeUntil).getTime() > Date.now()) {
    return s.freeUntil(s.names[p.plan], date(p.freeUntil));
  }
  if (p.plan !== 'trial' && p.hasAccess && p.currentPeriodEnd) return s.paidUntil(s.names[p.plan], date(p.currentPeriodEnd));
  if (p.status === 'trialing') return p.hasAccess ? s.trialEnds(date(p.trialEndsAt)) : s.trialEnded(date(p.trialEndsAt));
  return '';
}

function PlanCard({
  entry,
  info,
  label,
  selected,
  current,
  onPress,
}: {
  entry: PlanCatalogEntry;
  info: PlanInfo;
  label: string;
  selected: boolean;
  current: boolean;
  onPress: () => void;
}) {
  const { code: plan, priceSen, resourceLimit } = entry;
  const over = info.resourceCount > resourceLimit;
  const features = [
    s.upTo(resourceLimit, label),
    ...s.featuresBase,
    ...PLAN_FEATURES.filter((f) => entry.features[f]).map((f) => s.features[f]),
  ];
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
          {s.yourPrice(s.count(info.resourceCount, label), formatRM(planEntryMonthlySen(entry, info.resourceCount)))}
        </Text>
      ) : null}
    </Pressable>
  );
}
