import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { colors } from '@/theme';
import { Icon } from './ui/Icon';
import { Text } from './ui/Text';

/**
 * Pushed (non-tab) page: back button (wireframe .icb), title, optional right action,
 * scrolling body and an optional sticky footer (Save button).
 */
export function StackScreen({
  title,
  subtitle,
  right,
  footer,
  backHref = '/setup',
  children,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  footer?: ReactNode;
  /** Where Back goes when there is no history (deep link, web reload). */
  backHref?: Href;
  children: ReactNode;
}) {
  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View className="flex-row items-center gap-3 px-4 pb-2 pt-3">
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace(backHref))}
            accessibilityRole="button"
            accessibilityLabel="Back"
            className="h-11 w-11 items-center justify-center rounded-button border border-border bg-card active:bg-pressed"
          >
            <Icon name="chevron-left" color={colors.text} />
          </Pressable>
          <View className="flex-1">
            <Text className="text-[20px] font-extrabold" numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text className="text-[12px] text-muted" numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {right}
        </View>
        <ScrollView contentContainerClassName="gap-4 px-4 pb-8 pt-2" keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? <View className="border-t border-border bg-card px-4 pb-3 pt-3">{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Square icon button for headers (add, delete). */
export function HeaderIconButton({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: 'plus' | 'trash' | 'copy';
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-11 w-11 items-center justify-center rounded-button border border-border bg-card active:bg-pressed"
    >
      <Icon name={icon} color={danger ? colors.danger : colors.text} />
    </Pressable>
  );
}
