import { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { PublicBusiness, PublicService, PublicSlot } from '@outletbooking/shared';
import { Card } from '@/components/ui/Card';
import { Chip, ChipChoice } from '@/components/ui/Chip';
import { FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { bookableDays, longDate, slotHour, slotTime } from '@/features/public/format';
import { parseISO } from 'date-fns';
import { usePublicSlots, usePublicSlotsForDays } from '@/features/public/hooks';
import { formatDuration, formatRM } from '@/lib/format';
import { t } from '@/strings/en';

const b = t.book;

export interface TimeChoice {
  slot: PublicSlot;
  /** Chosen resource, or undefined = "any" (least busy free one). */
  resourceId?: number;
}

/**
 * C2 court grid (sports) or F1 date & time (other types); F2 when the day is full.
 * The court grid picks the court; elsewhere customers may pick a person when the business allows it.
 */
export function TimeStep({
  slug,
  biz,
  service,
  today,
  date,
  onDate,
  durationMin,
  onDuration,
  resourceId,
  onResource,
  choice,
  onChoice,
}: {
  slug: string;
  biz: PublicBusiness;
  service: PublicService;
  today: string;
  date: string;
  onDate: (d: string) => void;
  durationMin: number;
  onDuration: (m: number) => void;
  resourceId: number | undefined;
  onResource: (id: number | undefined) => void;
  choice: TimeChoice | null;
  onChoice: (c: TimeChoice | null) => void;
}) {
  const days = useMemo(() => bookableDays(today, biz.maxDaysAhead), [today, biz.maxDaysAhead]);
  const resources = biz.resources.filter((r) => r.serviceIds.includes(service.id));
  const grid = biz.template === 'sports' && resources.length > 1;
  const canPick = !grid && biz.settings.customersPickResource !== false && resources.length > 1;
  const query = { serviceId: service.id, date, durationMin, resourceId: grid ? undefined : resourceId };
  const slots = usePublicSlots(slug, query);
  const tz = biz.timezone;

  const options = service.durationOptions?.length ? service.durationOptions : null;
  const list = slots.data?.slots ?? [];

  return (
    <View className="gap-4">
      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{days.find((d) => d.date === date)?.month ?? ''}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          {days.map((d) => {
            const on = d.date === date;
            return (
              <Pressable
                key={d.date}
                onPress={() => onDate(d.date)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={longDate(d.date)}
                className={`h-[60px] w-[52px] items-center justify-center rounded-input border ${on ? 'border-primary bg-primary' : 'border-border bg-card'}`}
              >
                <Text className={`text-[12px] ${on ? 'text-white' : 'text-muted'}`}>{d.weekday}</Text>
                <Text className={`text-[17px] font-extrabold ${on ? 'text-white' : ''}`}>{d.day}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {options ? (
        <View className="gap-2">
          <Text className="text-[13px] font-bold text-label">{b.howLong}</Text>
          <ChipChoice options={options} value={durationMin} onChange={onDuration} format={formatDuration} />
        </View>
      ) : null}

      {canPick ? (
        <View className="gap-2">
          <Text className="text-[13px] font-bold text-label">{biz.resourceLabel}</Text>
          <View className="flex-row flex-wrap gap-2">
            <Chip role="radio" label={b.any} selected={resourceId === undefined} onPress={() => onResource(undefined)} />
            {resources.map((r) => (
              <Chip key={r.id} role="radio" label={r.name} selected={resourceId === r.id} onPress={() => onResource(r.id)} />
            ))}
          </View>
        </View>
      ) : null}

      {slots.isPending ? (
        <LoadingState label={b.loadingTimes} />
      ) : slots.error ? (
        <FormError message={errorMessage(slots.error)} />
      ) : list.length === 0 ? (
        <FullyBooked slug={slug} biz={biz} date={date} days={days.map((d) => d.date)} query={query} onChoice={(c, d) => {
          onDate(d);
          onChoice(c);
        }} />
      ) : grid ? (
        <CourtGrid biz={biz} slots={list} resources={resources} choice={choice} onChoice={onChoice} durationMin={durationMin} />
      ) : (
        <TimeList tz={tz} slots={list} choice={choice} onChoice={(slot) => onChoice({ slot, resourceId })} />
      )}
      {list.length ? <Text className="text-[12px] text-muted">{b.malaysiaTime}</Text> : null}
    </View>
  );
}

/** F1 · times grouped Morning / Afternoon / Evening. */
function TimeList({ tz, slots, choice, onChoice }: { tz: string; slots: PublicSlot[]; choice: TimeChoice | null; onChoice: (s: PublicSlot) => void }) {
  const groups = [
    { label: b.morning, test: (h: number) => h < 12 },
    { label: b.afternoon, test: (h: number) => h >= 12 && h < 17 },
    { label: b.evening, test: (h: number) => h >= 17 },
  ];
  return (
    <View className="gap-3">
      {groups.map((g) => {
        const items = slots.filter((s) => g.test(slotHour(s.startAt, tz)));
        if (!items.length) return null;
        return (
          <View key={g.label} className="gap-2">
            <Text className="text-[13px] font-bold text-label">{g.label}</Text>
            <View className="flex-row flex-wrap gap-2">
              {items.map((s) => (
                <Chip key={s.startAt} role="radio" label={slotTime(s.startAt, tz)} selected={choice?.slot.startAt === s.startAt} onPress={() => onChoice(s)} />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** C2 · resources across, start times down; free cells show the price. */
function CourtGrid({
  biz,
  slots,
  resources,
  choice,
  onChoice,
  durationMin,
}: {
  biz: PublicBusiness;
  slots: PublicSlot[];
  resources: PublicBusiness['resources'];
  choice: TimeChoice | null;
  onChoice: (c: TimeChoice) => void;
  durationMin: number;
}) {
  const tz = biz.timezone;
  return (
    <View className="gap-2">
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="gap-1.5">
          <View className="flex-row gap-1.5">
            <View className="w-[64px]" />
            {resources.map((r) => (
              <Text key={r.id} className="w-[76px] text-center text-[12px] font-bold text-label" numberOfLines={1}>
                {r.name}
              </Text>
            ))}
          </View>
          {slots.map((s) => (
            <View key={s.startAt} className="flex-row items-center gap-1.5">
              <Text className="w-[64px] text-[12px] font-semibold text-muted">{slotTime(s.startAt, tz)}</Text>
              {resources.map((r) => {
                const free = s.resourceIds.includes(r.id);
                const on = choice?.slot.startAt === s.startAt && choice.resourceId === r.id;
                return (
                  <Pressable
                    key={r.id}
                    disabled={!free}
                    onPress={() => onChoice({ slot: s, resourceId: r.id })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on, disabled: !free }}
                    accessibilityLabel={`${r.name} ${slotTime(s.startAt, tz)} ${free ? formatRM(s.priceSen) : b.takenCell}`}
                    className={`h-[44px] w-[76px] items-center justify-center rounded-[8px] ${
                      on ? 'bg-primary' : free ? 'border border-primary bg-soft' : 'bg-neutral-bg'
                    }`}
                  >
                    <Text className={`text-[12px] font-bold ${on ? 'text-white' : free ? 'text-primary' : 'text-muted'}`}>
                      {on ? b.selected : free ? formatRM(s.priceSen).replace(' ', '') : b.takenCell}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      <Text className="text-[12px] text-muted">{b.gridHint(formatDuration(durationMin))}</Text>
    </View>
  );
}

/** F2 · the day is full: offer the next free times on the following days. */
function FullyBooked({
  slug,
  biz,
  date,
  days,
  query,
  onChoice,
}: {
  slug: string;
  biz: PublicBusiness;
  date: string;
  days: string[];
  query: { serviceId: number; durationMin: number; resourceId?: number };
  onChoice: (c: TimeChoice, date: string) => void;
}) {
  const next = days.filter((d) => d > date).slice(0, 7);
  const results = usePublicSlotsForDays(slug, query, next);
  const loading = results.some((r) => r.isPending);
  const offers = results
    .flatMap((r, i) => (r.data?.slots ?? []).map((slot) => ({ slot, date: next[i]! })))
    .slice(0, 3);
  const name = (id: number | undefined) => biz.resources.find((r) => r.id === id)?.name;
  // A weekday without opening hours is closed, not full.
  const closed = !biz.hours.some((h) => h.weekday === parseISO(date).getDay());
  return (
    <Card className="gap-3 p-4">
      <Text className="text-[16px] font-extrabold">{closed ? b.closedOn(longDate(date)) : b.fullyBooked(longDate(date))}</Text>
      {closed ? null : <Text className="text-[13px] text-muted">{b.fullyBookedBody(biz.resourceLabel)}</Text>}
      <Text className="text-[13px] font-bold text-label">{b.nextAvailable}</Text>
      {loading ? (
        <LoadingState label={b.loadingTimes} />
      ) : offers.length ? (
        offers.map(({ slot, date: d }) => (
          <Pressable
            key={slot.startAt}
            onPress={() => onChoice({ slot, resourceId: query.resourceId ?? slot.resourceIds[0] }, d)}
            accessibilityRole="button"
            className="flex-row items-center justify-between rounded-input border border-border bg-card px-3.5 py-3 active:bg-pressed"
          >
            <Text className="text-[14px] font-bold">{`${longDate(d)} · ${slotTime(slot.startAt, biz.timezone)}`}</Text>
            <Text className="text-[13px] text-muted">
              {[name(query.resourceId ?? slot.resourceIds[0]), slot.priceSen ? formatRM(slot.priceSen) : b.free].filter(Boolean).join(' · ')}
            </Text>
          </Pressable>
        ))
      ) : (
        <Text className="text-[13px] text-muted">{b.noneSoon}</Text>
      )}
    </Card>
  );
}
