import { useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, type Href } from 'expo-router';
import {
  TEMPLATE_INFO,
  weeklyHoursLine,
  type BusinessTemplate,
  type SetupExtraRow,
  type SetupSummary,
} from '@outletbooking/shared';
import { ScreenTitle } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ListRow } from '@/components/ui/Rows';
import { ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Tag } from '@/components/ui/Tag';
import { Text } from '@/components/ui/Text';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/features/account/components/Avatar';
import { useMe } from '@/features/me/hooks';
import { useUpdateChecklist } from '@/features/onboarding/hooks';
import { usePaymentAccount } from '@/features/payments/hooks';
import { useBusiness, useSetupSummary } from '@/features/setup/hooks';
import { payPlace } from '@/features/setup/payment';
import { bookingUrl, bookingUrlLabel } from '@/lib/config';
import { formatDuration, formatRM } from '@/lib/format';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.setup.menu;
const x = s.extras;

interface Row {
  key: string;
  title: string;
  subtitle?: string;
  href?: Href;
  /** Shown under the title for type-specific rows. */
  onlyThisType?: boolean;
  /** Not built yet: shown with a "Soon" tag, not tappable. */
  soon?: boolean;
}

function priceRange(sum: SetupSummary): string | null {
  const { minPriceSen: min, maxPriceSen: max } = sum.services;
  if (min === null || max === null) return null;
  if (max === 0) return s.free;
  return min === max ? formatRM(min) : `${formatRM(min)}–${formatRM(max).replace('RM ', '')}`;
}

/** The two "Only for this type" rows from the template config. */
function extraRow(key: SetupExtraRow, sum: SetupSummary): Row {
  const label = sum.resourceLabel;
  const base = { key, onlyThisType: true };
  switch (key) {
    case 'peak_hours':
      return {
        ...base,
        title: x.peak_hours.title,
        subtitle: sum.services.peakServiceCount ? x.peak_hours.on(sum.services.peakServiceCount) : x.peak_hours.off,
        href: '/setup/services',
      };
    case 'booking_length': {
      const opts = sum.services.durationOptions;
      const parts = [
        opts.length ? opts.map((m) => formatDuration(m)).join(', ') : x.booking_length.fixed,
        sum.services.maxBufferMin ? x.booking_length.changeover(formatDuration(sum.services.maxBufferMin)) : null,
      ];
      return { ...base, title: x.booking_length.title, subtitle: parts.filter(Boolean).join(' · '), href: '/setup/services' };
    }
    case 'travel': {
      const areas = typeof sum.settings.serviceArea === 'string' && sum.settings.serviceArea ? sum.settings.serviceArea : x.travel.areas;
      const gap = sum.services.maxTravelBufferMin;
      return {
        ...base,
        title: x.travel.title,
        subtitle: `${gap ? x.travel.between(formatDuration(gap)) : x.travel.none} · ${areas}`,
        href: '/setup/extra/travel',
      };
    }
    case 'mobile_inspection': {
      const on = sum.mobileServiceVisible === true;
      const fee = typeof sum.settings.mobileFeeSen === 'number' ? x.mobile_inspection.fee(formatRM(sum.settings.mobileFeeSen)) : null;
      const area = typeof sum.settings.serviceArea === 'string' ? sum.settings.serviceArea : null;
      return {
        ...base,
        title: x.mobile_inspection.title,
        subtitle: on ? [x.mobile_inspection.on, fee, area].filter(Boolean).join(' · ') : x.mobile_inspection.off,
        href: '/setup/extra/mobile',
      };
    }
    case 'resource_schedules':
      return { ...base, title: x.resource_schedules.title(label), subtitle: x.resource_schedules.sub(label), href: '/setup/resources' };
    case 'resource_label':
      return { ...base, title: x.resource_label.title, subtitle: x.resource_label.sub(label), href: '/setup/profile' };
    // Listings / checklist need the PRD go-ahead; the rest come after MVP.
    default:
      return { ...base, title: x[key].title, soon: true };
  }
}

function buildSections(sum: SetupSummary, trial: string, payments: string): { title: string; rows: Row[] }[] {
  const template = sum.template as BusinessTemplate;
  const info = TEMPLATE_INFO[template];
  const label = sum.resourceLabel;
  const range = priceRange(sum);

  const hours = sum.hoursVary ? s.hoursVary(label) : sum.hours.length ? weeklyHoursLine(sum.hours) : s.hoursNone;
  const ahead = sum.rules.minAdvanceMin ? formatDuration(sum.rules.minAdvanceMin) : s.noLimit;
  const cancel = sum.rules.customersCanCancel ? (sum.rules.cancelCutoffMin ? formatDuration(sum.rules.cancelCutoffMin) : s.noLimit) : null;
  const place = payPlace(template);
  const payment =
    sum.paymentRule === null
      ? s.paymentSummary.empty
      : sum.paymentRule === 'deposit'
        ? template === 'real_estate'
          ? t.setup.paymentRule.fee
          : s.paymentSummary.deposit(formatRM(sum.maxDepositSen), place)
        : sum.paymentRule === 'at_venue'
          ? s.paymentSummary.at_venue(place)
          : s.paymentSummary[sum.paymentRule];

  return [
    {
      title: s.whatCustomersBook,
      rows: [
        {
          key: 'resources',
          title: s.resourcesTitle(label),
          subtitle: [s.resourcesCount(sum.resources.count, label), sum.resources.linkedToStaff ? s.linkedStaff(sum.resources.linkedToStaff) : null]
            .filter(Boolean)
            .join(' · '),
          href: '/setup/resources',
        },
        {
          key: 'services',
          title: s.servicesTitle[template],
          subtitle: [s.servicesCount(sum.services.count), range].filter(Boolean).join(' · '),
          href: '/setup/services',
        },
        ...info.setupExtras.map((key) => extraRow(key, sum)),
      ],
    },
    {
      title: s.rulesSection,
      rows: [
        { key: 'hours', title: s.openingHours, subtitle: hours, href: '/setup/resources' },
        { key: 'time-off', title: s.timeOff, subtitle: s.timeOffSub, href: '/setup/time-off' },
        { key: 'rules', title: t.setup.profile.rulesTitle, subtitle: s.rulesLine(ahead, sum.rules.maxDaysAhead, cancel), href: '/setup/rules' },
        { key: 'payment', title: s.paymentRow, subtitle: payment, href: '/setup/payment-rule' },
        { key: 'payments', title: s.paymentsRow, subtitle: payments, href: '/setup/payments' },
        { key: 'form', title: s.bookingForm, subtitle: s.bookingFormLine(sum.bookingFields), href: '/setup/fields' },
      ],
    },
    {
      title: s.businessSection,
      rows: [
        { key: 'profile', title: s.profile, subtitle: s.profileSub, href: '/setup/profile' },
        { key: 'staff', title: s.staffRoles, subtitle: s.staffCount(sum.staffCount), href: '/setup/staff' },
        { key: 'reminders', title: s.reminders, subtitle: s.remindersSub, href: '/today/reminders' },
        { key: 'plan', title: s.plan, subtitle: trial, href: '/setup/plan' },
      ],
    },
  ];
}

/** ST · Setup tab: one screen for every business type, rows driven by the template config. */
export default function SetupScreen() {
  const { me } = useMe();
  const business = useBusiness();
  const summary = useSetupSummary();
  const updateChecklist = useUpdateChecklist();
  const account = usePaymentAccount(me?.role === 'owner');

  // Edits happen deeper in the Setup stack; refresh the summaries when coming back.
  useFocusEffect(
    useCallback(() => {
      void summary.refetch();
      void account.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  if (!business.data || !summary.data) {
    const error = business.error ?? summary.error;
    return (
      <SafeAreaView edges={['top']} className="flex-1 bg-bg">
        {error ? (
          <ErrorState
            error={error}
            onRetry={() => {
              void business.refetch();
              void summary.refetch();
            }}
          />
        ) : (
          <LoadingState />
        )}
      </SafeAreaView>
    );
  }

  const biz = business.data;
  const sum = summary.data;
  const sub = me?.subscription;
  const trial = !sub ? '' : sub.status === 'trialing' ? s.planTrial(sub.trialDaysLeft) : s.planActive(sub.plan);
  const acc = account.data;
  const payments = !acc
    ? ''
    : acc.status !== 'connected'
      ? t.payments.rowNotConnected
      : acc.testedAt
        ? t.payments.rowConnected
        : t.payments.rowTestPending;
  const sections = buildSections(sum, trial, payments);
  const typeName = t.templates[sum.template as keyof typeof t.templates]?.title ?? sum.template;

  const share = async () => {
    const result = await Share.share({ message: s.shareMessage(biz.name, bookingUrl(biz.slug)) });
    if (result.action === Share.sharedAction) updateChecklist.mutate({ linkShared: true });
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      <ScrollView
        contentContainerClassName="gap-4 px-4 pb-8 pt-3"
        refreshControl={
          <RefreshControl
            refreshing={summary.isRefetching}
            onRefresh={() => {
              void summary.refetch();
              void business.refetch();
            }}
            tintColor={colors.primary}
          />
        }
      >
        <View className="flex-row items-center justify-between">
          <ScreenTitle title={t.setup.title} subtitle={`${biz.name} · ${typeName}`} />
          {me ? (
            <Pressable
              onPress={() => router.push('/setup/account')}
              accessibilityRole="button"
              accessibilityLabel={t.account.open}
              className="h-11 w-11 items-center justify-center rounded-full active:opacity-70"
            >
              <Avatar name={me.user.name} size={40} />
            </Pressable>
          ) : null}
        </View>

        {!biz.bookingEnabled ? (
          <Pressable
            onPress={() => router.push('/setup/rules')}
            className="flex-row items-center gap-2 rounded-card bg-pend-bg px-3.5 py-3"
            accessibilityRole="button"
          >
            <Icon name="pause" size={18} color={colors['pend-fg']} />
            <Text className="flex-1 text-[14px] font-bold text-pend-fg">{s.bookingOff}</Text>
          </Pressable>
        ) : null}

        <Card className="flex-row items-center gap-3 p-3.5">
          <View className="flex-1 gap-0.5">
            <Text className="text-[13px] font-bold text-label">{s.bookingPage}</Text>
            <Text className="text-[14px] font-semibold text-primary" numberOfLines={1}>
              {bookingUrlLabel(biz.slug)}
            </Text>
          </View>
          <Button variant="secondary" title={s.share} onPress={() => void share()} className="px-4" />
        </Card>

        {sections.map((section) => (
          <View key={section.title} className="gap-2">
            <Text className="text-[13px] font-bold text-label">{section.title}</Text>
            <Card className="overflow-hidden">
              {section.rows.map((row, i) => (
                <ListRow
                  key={row.key}
                  title={row.title}
                  subtitle={[row.onlyThisType ? s.onlyThisType : null, row.subtitle].filter(Boolean).join(' · ') || undefined}
                  right={row.soon ? <Tag label={s.soon} /> : undefined}
                  onPress={row.href && !row.soon ? () => router.push(row.href!) : undefined}
                  last={i === section.rows.length - 1}
                />
              ))}
            </Card>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
