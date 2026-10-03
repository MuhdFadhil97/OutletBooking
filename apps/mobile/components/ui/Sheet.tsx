import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { Icon } from './Icon';
import { Text } from './Text';

/** Bottom sheet modal used by pickers and small editors. */
export function Sheet({
  visible,
  title,
  onClose,
  children,
  scroll = true,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable className="flex-1 bg-black/40" onPress={onClose} accessibilityLabel="Close" />
        <View
          className="max-h-[85%] rounded-t-[20px] bg-card px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-[18px] font-extrabold">{title}</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              className="h-11 w-11 items-center justify-center"
            >
              <Icon name="x" color={colors.text} />
            </Pressable>
          </View>
          {scroll ? (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 pb-2">
              {children}
            </ScrollView>
          ) : (
            <View className="gap-4">{children}</View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
