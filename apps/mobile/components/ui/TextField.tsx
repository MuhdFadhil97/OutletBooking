import { forwardRef, type ReactNode } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { colors } from '@/theme';
import { Text } from './Text';

interface Props extends TextInputProps {
  label: string;
  error?: string;
  hint?: string;
  /** Fixed text shown before the input, e.g. "outletbooking.my/book/" */
  prefix?: string;
  /** Element after the input (status, icon) */
  right?: ReactNode;
  compact?: boolean;
}

export const TextField = forwardRef<TextInput, Props>(function TextField(
  { label, error, hint, prefix, right, compact, ...props },
  ref,
) {
  return (
    <View className="gap-1.5">
      <Text className="text-[13px] font-bold text-label">{label}</Text>
      <View
        className={`flex-row items-center rounded-input border bg-card px-3.5 ${compact ? 'h-[46px]' : 'h-[50px]'} ${
          error ? 'border-danger' : 'border-input-border'
        }`}
      >
        {prefix ? <Text className="text-[15px] text-muted">{prefix}</Text> : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.muted}
          className="h-full flex-1 font-sans text-[15px] text-text"
          {...props}
        />
        {right}
      </View>
      {error ? (
        <Text className="text-[12px] text-danger">{error}</Text>
      ) : hint ? (
        <Text className="text-[12px] text-muted">{hint}</Text>
      ) : null}
    </View>
  );
});
