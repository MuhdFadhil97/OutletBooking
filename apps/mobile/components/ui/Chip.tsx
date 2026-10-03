import { Pressable, View } from 'react-native';
import { Text } from './Text';

/** Toggle chip (wireframe .chip / .chip.on): 36px tall pill, green when selected. */
export function Chip({
  label,
  selected,
  onPress,
  disabled,
  role = 'checkbox',
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  role?: 'checkbox' | 'radio';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={role}
      accessibilityState={{ checked: selected, disabled }}
      hitSlop={4}
      className={`h-9 items-center justify-center rounded-full border px-3.5 ${
        selected ? 'border-primary bg-primary' : 'border-input-border bg-card active:bg-pressed'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className={`text-[13px] font-semibold ${selected ? 'text-white' : 'text-text'}`}>{label}</Text>
    </Pressable>
  );
}

/** Single choice from preset values. A current value outside the presets is shown as an extra chip. */
export function ChipChoice<T extends string | number>({
  options,
  value,
  onChange,
  format,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format: (v: T) => string;
}) {
  const all = options.includes(value) ? options : [...options, value];
  return (
    <View className="flex-row flex-wrap gap-2">
      {all.map((o) => (
        <Chip key={String(o)} role="radio" label={format(o)} selected={o === value} onPress={() => onChange(o)} />
      ))}
    </View>
  );
}
