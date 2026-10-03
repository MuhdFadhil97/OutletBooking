import type { ReactNode } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { colors } from '@/theme';
import { Icon } from './Icon';
import { Text } from './Text';

/** Tappable list row with chevron (settings menus, lists). */
export function ListRow({
  title,
  subtitle,
  left,
  right,
  onPress,
  last,
}: {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      className={`min-h-[56px] flex-row items-center gap-3 px-3.5 py-3 active:bg-pressed ${last ? '' : 'border-b border-border'}`}
    >
      {left}
      <View className="flex-1 gap-0.5">
        <Text className="text-[15px] font-bold">{title}</Text>
        {subtitle ? <Text className="text-[13px] text-muted">{subtitle}</Text> : null}
      </View>
      {right}
      {onPress ? <Icon name="chevron-right" size={18} color={colors.muted} /> : null}
    </Pressable>
  );
}

/** Label + optional hint + on/off switch (wireframe .sw). */
export function SwitchRow({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View className="min-h-[44px] flex-row items-center gap-3">
      <View className="flex-1 gap-0.5">
        <Text className="text-[14px] font-semibold">{label}</Text>
        {hint ? <Text className="text-[12px] text-muted">{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ true: colors.primary, false: '#B8C1BC' }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

/** Radio option (wireframe .radio / .dot). */
export function RadioRow({
  label,
  hint,
  selected,
  onPress,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      className="min-h-[44px] flex-row items-center gap-2.5"
    >
      <View
        className={`h-5 w-5 rounded-full ${selected ? 'border-[6px] border-primary' : 'border-2 border-[#9AA59F]'}`}
      />
      <Text className="text-[14px] font-semibold">{label}</Text>
      {hint ? <Text className="text-[14px] text-muted">{hint}</Text> : null}
    </Pressable>
  );
}

/** Small uppercase-ish section label (wireframe .lbl) with an optional action on the right. */
export function SectionLabel({ label, action }: { label: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View className="min-h-[28px] flex-row items-center justify-between">
      <Text className="text-[13px] font-bold text-label">{label}</Text>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={10} accessibilityRole="button" className="min-h-[44px] justify-center">
          <Text className="text-[14px] font-bold text-primary">{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
