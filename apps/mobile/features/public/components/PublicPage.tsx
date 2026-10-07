import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { t } from '@/strings/en';
import { colors } from '@/theme';

/**
 * Public (no login) page frame: phone-width column centred on desktop, optional back button,
 * progress bar and a sticky footer for the main action (wireframes C1–C4).
 */
export function PublicPage({
  title,
  subtitle,
  onBack,
  progress,
  footer,
  children,
}: {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  progress?: { current: number; total: number };
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SafeAreaView className="flex-1 bg-bg">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {title ? (
          <View className="mx-auto w-full max-w-[560px] gap-3 px-4 pb-1 pt-3">
            <View className="flex-row items-center gap-3">
              {onBack ? (
                <Pressable
                  onPress={onBack}
                  accessibilityRole="button"
                  accessibilityLabel={t.common.back}
                  className="h-11 w-11 items-center justify-center rounded-button border border-border bg-card active:bg-pressed"
                >
                  <Icon name="chevron-left" color={colors.text} />
                </Pressable>
              ) : null}
              <View className="flex-1">
                <Text className="text-[18px] font-extrabold" numberOfLines={1}>
                  {title}
                </Text>
                {subtitle ? (
                  <Text className="text-[13px] text-muted" numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
            </View>
            {progress ? <Progress {...progress} /> : null}
          </View>
        ) : null}
        <ScrollView contentContainerClassName="mx-auto w-full max-w-[560px] gap-4 px-4 pb-8 pt-3" keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? (
          <View className="border-t border-border bg-card">
            <View className="mx-auto w-full max-w-[560px] gap-2 px-4 pb-3 pt-3">{footer}</View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Progress({ current, total }: { current: number; total: number }) {
  return (
    <View className="flex-row gap-1.5" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: current }}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} className={`h-1 flex-1 rounded-sm ${i < current ? 'bg-primary' : 'bg-border'}`} />
      ))}
    </View>
  );
}

/** Label / value row in summary cards (wireframe .row). */
export function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View className="flex-row justify-between gap-3">
      <Text className="text-[14px] text-muted">{label}</Text>
      <Text className={`flex-1 text-right text-[14px] ${strong ? 'font-extrabold' : 'font-bold'}`}>{value}</Text>
    </View>
  );
}
