import { Pressable, View } from 'react-native';
import type { PublicBusiness, PublicService } from '@outletbooking/shared';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { durationsLabel, priceLabel } from '@/features/public/format';
import { formatRM } from '@/lib/format';
import { t } from '@/strings/en';

const b = t.book;

/** C1 · Choose a service. */
export function ServiceStep({
  biz,
  selected,
  onSelect,
}: {
  biz: PublicBusiness;
  selected: number | null;
  onSelect: (svc: PublicService) => void;
}) {
  const svc = biz.services.find((s) => s.id === selected);
  const note = svc
    ? [
        svc.prepayFull ? b.payFull : svc.depositSen ? b.payDeposit(formatRM(svc.depositSen)) : null,
        biz.settings.pricesFrom ? b.pricesFrom : null,
      ]
        .filter(Boolean)
        .join(' ')
    : null;

  return (
    <View className="gap-3">
      <Text className="text-[14px] text-muted">{b.whatToBook}</Text>
      <Card className="overflow-hidden">
        {biz.services.map((s, i) => {
          const on = s.id === selected;
          return (
            <Pressable
              key={s.id}
              onPress={() => onSelect(s)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              className={`min-h-[64px] flex-row items-center gap-3 px-4 py-3 ${on ? 'bg-soft' : 'active:bg-pressed'} ${
                i < biz.services.length - 1 ? 'border-b border-border' : ''
              }`}
            >
              <View className={`h-5 w-5 items-center justify-center rounded-full border-2 ${on ? 'border-primary' : 'border-input-border'}`}>
                {on ? <View className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="text-[16px] font-bold">{s.name}</Text>
                <Text className="text-[13px] text-muted">
                  {[durationsLabel(s), priceLabel(s, biz.settings.pricesFrom), s.locationType === 'at_customer_location' ? b.atYourPlace : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                {s.description ? <Text className="text-[13px] text-muted">{s.description}</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </Card>
      {note ? <Text className="text-[13px] text-muted">{note}</Text> : null}
    </View>
  );
}
