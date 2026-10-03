import { View } from 'react-native';
import { Text } from './Text';

const tones = {
  ok: 'bg-ok-bg text-ok-fg',
  pending: 'bg-pend-bg text-pend-fg',
  neutral: 'bg-neutral-bg text-neutral-fg',
  info: 'bg-info-bg text-info-fg',
} as const;

export type TagTone = keyof typeof tones;

/** Status chip (wireframe .tag / .t-ok / .t-pend / .t-gray / .t-blue) */
export function Tag({ label, tone = 'neutral' }: { label: string; tone?: TagTone }) {
  const [bg, fg] = tones[tone].split(' ');
  return (
    <View className={`h-6 justify-center self-start rounded-full px-2.5 ${bg}`}>
      <Text className={`text-[12px] font-bold ${fg}`}>{label}</Text>
    </View>
  );
}
