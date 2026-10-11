import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { formatInTimeZone } from 'date-fns-tz';
import { BOOKING_SEARCH_FILTERS, type Booking, type BookingSearchFilter } from '@outletbooking/shared';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Tag } from '@/components/ui/Tag';
import { Text } from '@/components/ui/Text';
import { paymentSummary, statusTone } from '@/features/bookings/format';
import { SEARCH_LIMIT, useBookingSearch } from '@/features/bookings/hooks';
import { openBooking } from '@/features/bookings/nav';
import { useBookingFields, useBusiness } from '@/features/setup/hooks';
import { formatRM } from '@/lib/format';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const l = t.bookingsList;

/** O9 · Bookings: search by name / phone / plate, filter, grouped Upcoming then Past. */
export default function BookingsScreen() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<BookingSearchFilter>('all');
  const [focused, setFocused] = useState(false);
  const business = useBusiness();
  const fields = useBookingFields();
  const search = useBookingSearch(q, filter);

  // Search 300 ms after the owner stops typing.
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);

  useFocusEffect(
    useCallback(() => {
      void search.refetch();
    }, [search.refetch]), // eslint-disable-line react-hooks/exhaustive-deps
  );

  const tz = business.data?.timezone ?? 'Asia/Kuala_Lumpur';
  const searchableKeys = (fields.data ?? []).filter((f) => f.isSearchable).map((f) => f.fieldKey);

  let body;
  if (search.error && !search.data) {
    body = <ErrorState error={search.error} onRetry={() => void search.refetch()} />;
  } else if (!search.data) {
    body = <LoadingState />;
  } else if (search.data.length === 0) {
    body = q ? (
      <EmptyState icon={<Icon name="search" size={28} color={colors.muted} />} title={l.noMatch} body={l.noMatchBody} />
    ) : (
      <EmptyState icon={<Icon name="list" size={28} color={colors.muted} />} title={l.empty} body={l.emptyBody} />
    );
  } else {
    const rows = search.data;
    const now = Date.now();
    const upcoming = rows.filter((b) => new Date(b.endAt).getTime() >= now);
    const past = rows.filter((b) => new Date(b.endAt).getTime() < now);
    const customers = new Set(rows.map((b) => b.customer.id)).size;
    body = (
      <ScrollView contentContainerClassName="gap-2.5 px-4 pb-8 pt-3" keyboardShouldPersistTaps="handled">
        <Text className="text-[13px] text-muted">{q ? l.matching(rows.length, customers, q) : l.count(rows.length)}</Text>
        {[
          { title: l.upcoming, list: upcoming },
          { title: l.past, list: past },
        ]
          .filter((g) => g.list.length)
          .map((g) => (
            <View key={g.title} className="gap-2.5">
              <Text className="px-0.5 pt-1 text-[12px] font-extrabold uppercase tracking-[0.6px] text-muted">{g.title}</Text>
              <Card className="overflow-hidden">
                {g.list.map((b, i) => (
                  <BookingRow key={b.id} b={b} tz={tz} q={q} searchableKeys={searchableKeys} first={i === 0} />
                ))}
              </Card>
            </View>
          ))}
        {rows.length >= SEARCH_LIMIT ? <Text className="text-center text-[12px] text-muted">{l.limited(SEARCH_LIMIT)}</Text> : null}
      </ScrollView>
    );
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      <View className="gap-3 border-b border-border bg-card px-4 pb-3 pt-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-[20px] font-extrabold">{l.title}</Text>
          {/* D10 customers list */}
          <Pressable
            onPress={() => router.push('/bookings/customers')}
            accessibilityRole="button"
            className="h-11 flex-row items-center gap-1.5 rounded-button border border-border bg-card px-3 active:bg-pressed"
          >
            <Icon name="users" size={18} color={colors.text} />
            <Text className="text-[13px] font-bold">{t.customers.title}</Text>
          </Pressable>
        </View>
        <View
          className={`h-12 flex-row items-center gap-2 rounded-button border-2 bg-card px-3 ${focused ? 'border-primary' : 'border-input-border'}`}
        >
          <Icon name="search" color={colors.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={l.search}
            placeholderTextColor={colors.muted}
            accessibilityLabel={l.search}
            autoCorrect={false}
            returnKeyType="search"
            className="h-10 min-w-0 flex-1 font-semibold text-[15px] text-text"
          />
          {text ? (
            <Pressable
              onPress={() => setText('')}
              accessibilityRole="button"
              accessibilityLabel={l.clear}
              hitSlop={6}
              className="h-8 w-8 items-center justify-center rounded-full bg-neutral-bg"
            >
              <Icon name="x" size={16} color={colors['neutral-fg']} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          {BOOKING_SEARCH_FILTERS.map((f) => (
            <Chip key={f} role="radio" label={l.filters[f]} selected={filter === f} onPress={() => setFilter(f)} />
          ))}
        </ScrollView>
      </View>
      {body}
    </SafeAreaView>
  );
}

function BookingRow({
  b,
  tz,
  q,
  searchableKeys,
  first,
}: {
  b: Booking;
  tz: string;
  q: string;
  searchableKeys: string[];
  first: boolean;
}) {
  // e.g. "Pre-purchase inspection · WXY 1234"
  const ref = searchableKeys.map((k) => b.customFields[k]).find((v) => v !== undefined && v !== '');
  const when = formatInTimeZone(new Date(b.startAt), tz, 'EEE, d MMM · h:mm a');
  const pay = paymentSummary(b);
  return (
    <Pressable
      onPress={() => openBooking('bookings', b.id)}
      accessibilityRole="button"
      className={`flex-row gap-3 px-3.5 py-3 active:bg-pressed ${first ? '' : 'border-t border-border'}`}
    >
      <View className="flex-1 gap-[3px]">
        <Highlight text={b.customer.name} q={q} />
        <Text className="text-[13px] text-muted" numberOfLines={1}>
          {b.service.name}
          {ref !== undefined ? ` · ${String(ref)}` : ''}
        </Text>
        <Text className="text-[13px] font-semibold" numberOfLines={1}>
          {when} · {b.resource.name}
        </Text>
      </View>
      <View className="items-end gap-1.5">
        <Tag label={t.booking.status[b.status]} tone={statusTone[b.status]} />
        <Text className="text-right text-[13px] font-bold">{b.priceSen ? formatRM(b.priceSen) : ''}</Text>
        {pay ? <Text className="text-right text-[12px] font-semibold text-muted">{pay}</Text> : null}
      </View>
    </Pressable>
  );
}

/** Customer name with the searched part marked (wireframe .hl). */
function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) {
    return (
      <Text className="text-[15px] font-extrabold" numberOfLines={1}>
        {text}
      </Text>
    );
  }
  return (
    <Text className="text-[15px] font-extrabold" numberOfLines={1}>
      {text.slice(0, i)}
      <Text className="rounded-[3px] bg-[#FFF2A8] text-[15px] font-extrabold">{text.slice(i, i + q.length)}</Text>
      {text.slice(i + q.length)}
    </Text>
  );
}
