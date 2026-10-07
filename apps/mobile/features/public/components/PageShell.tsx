import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { shortTime, type PublicBusiness } from '@outletbooking/shared';
import { Text } from '@/components/ui/Text';
import { todayHours } from '@/features/public/format';
import { t } from '@/strings/en';

const b = t.book;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** Customer pages: business header, content, optional sticky footer, "Powered by OutletBooking". */
export function PageShell({
  biz,
  title,
  step,
  children,
  footer,
  compactHeader,
}: {
  biz: Pick<PublicBusiness, 'name' | 'address'> & Partial<PublicBusiness>;
  title?: string;
  step?: string;
  children: ReactNode;
  footer?: ReactNode;
  compactHeader?: boolean;
}) {
  const typeName = biz.template ? (t.templates[biz.template as keyof typeof t.templates]?.title ?? null) : null;
  const sub = [typeName, biz.address].filter(Boolean).join(' · ');
  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="mx-auto w-full max-w-[560px] gap-4 px-4 pb-8 pt-4" keyboardShouldPersistTaps="handled">
        <View className="flex-row items-center gap-3">
          <View className="h-12 w-12 items-center justify-center rounded-card bg-primary">
            <Text className="text-[16px] font-extrabold text-white">{initials(biz.name)}</Text>
          </View>
          <View className="flex-1">
            <Text className="text-[18px] font-extrabold" numberOfLines={1}>
              {biz.name}
            </Text>
            {!compactHeader && sub ? (
              <Text className="text-[13px] text-muted" numberOfLines={1}>
                {sub}
              </Text>
            ) : null}
            {!compactHeader && biz.hours && biz.timezone ? (
              <Text className="text-[12px] text-muted">{todayHours(biz as PublicBusiness, shortTime)}</Text>
            ) : null}
          </View>
        </View>
        {step || title ? (
          <View className="gap-0.5">
            {step ? <Text className="text-[12px] font-bold uppercase tracking-[0.6px] text-muted">{step}</Text> : null}
            {title ? <Text className="text-[22px] font-extrabold">{title}</Text> : null}
          </View>
        ) : null}
        {children}
        <Text className="pt-4 text-center text-[12px] text-muted">{b.poweredBy}</Text>
      </ScrollView>
      {footer ? <View className="border-t border-border bg-card px-4 pb-3 pt-3">{<View className="mx-auto w-full max-w-[560px]">{footer}</View>}</View> : null}
    </SafeAreaView>
  );
}
