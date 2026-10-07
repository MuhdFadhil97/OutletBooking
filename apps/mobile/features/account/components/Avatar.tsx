import { View } from 'react-native';
import { Text } from '@/components/ui/Text';

/** "Muhammad Fadhil" → "MF" */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]![0], parts[parts.length - 1]![0]] : [parts[0]?.[0]];
  return letters.join('').toUpperCase() || '?';
}

/** Round initials badge (wireframe H6 header, Setup avatar). */
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  return (
    <View
      className="items-center justify-center rounded-full bg-soft"
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Text className="font-extrabold text-primary" style={{ fontSize: Math.round(size * 0.36) }}>
        {initials(name)}
      </Text>
    </View>
  );
}
