import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from './ui/Text';

/** Standard page: safe area + scroll + 16px gutters. */
export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      {scroll ? (
        <ScrollView contentContainerClassName="gap-4 px-4 pb-8 pt-3" keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View className="flex-1 gap-4 px-4 pt-3">{children}</View>
      )}
    </SafeAreaView>
  );
}

export function ScreenTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View className="gap-0.5 pt-1">
      {subtitle ? <Text className="text-[13px] font-semibold text-muted">{subtitle}</Text> : null}
      <Text className="text-[24px] font-extrabold">{title}</Text>
    </View>
  );
}
