import { View } from 'react-native';
import type { CustomerSummary, CustomerTag } from '@outletbooking/shared';
import { Tag } from '@/components/ui/Tag';
import { Text } from '@/components/ui/Text';
import { initials } from '@/features/staff-app/format';
import { t } from '@/strings/en';

const s = t.customers;

/** Avatar colour follows the tag (wireframe: green regulars, blue new, amber no-shows). */
const AVATAR: Record<CustomerTag | 'none', string> = {
  regular: 'bg-ok-bg text-ok-fg',
  new: 'bg-info-bg text-info-fg',
  no_shows: 'bg-pend-bg text-pend-fg',
  none: 'bg-neutral-bg text-neutral-fg',
};

export function CustomerAvatar({ name, tag, size = 40 }: { name: string; tag: CustomerTag | null; size?: number }) {
  const [bg, fg] = AVATAR[tag ?? 'none'].split(' ');
  return (
    <View className={`items-center justify-center rounded-full ${bg}`} style={{ width: size, height: size }}>
      <Text className={`font-extrabold ${fg}`} style={{ fontSize: size * 0.33 }}>
        {initials(name)}
      </Text>
    </View>
  );
}

export function CustomerTagView({ c }: { c: Pick<CustomerSummary, 'tag' | 'noShows'> }) {
  if (c.tag === 'no_shows') return <Tag label={s.noShowsTag(c.noShows)} tone="danger" />;
  if (c.tag === 'regular') return <Tag label={s.tags.regular} tone="ok" />;
  if (c.tag === 'new') return <Tag label={s.tags.new} tone="info" />;
  return null;
}
