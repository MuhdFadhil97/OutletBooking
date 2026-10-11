import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { format } from 'date-fns';
import { CUSTOMER_FILTERS, type CustomerFilter, type CustomerSummary } from '@outletbooking/shared';
import { HeaderIconButton } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { formatPhone } from '@/features/bookings/format';
import { CustomerAvatar, CustomerTagView } from '@/features/customers/components/CustomerBits';
import { CustomerSheet } from '@/features/customers/components/CustomerSheet';
import { useCustomers } from '@/features/customers/hooks';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.customers;
const PAGE = 50;

/** D10 · Customers: search name / mobile, Regulars / New / No-shows, add a customer. */
export default function CustomersScreen() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<CustomerFilter>('all');
  const [limit, setLimit] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  const list = useCustomers(q, filter, limit);

  // Search 300 ms after typing stops; a new search starts from the first page.
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(text.trim());
      setLimit(PAGE);
    }, 300);
    return () => clearTimeout(id);
  }, [text]);

  useFocusEffect(
    useCallback(() => {
      void list.refetch();
    }, [list.refetch]), // eslint-disable-line react-hooks/exhaustive-deps
  );

  const data = list.data;
  let body;
  if (list.error && !data) body = <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  else if (!data) body = <LoadingState />;
  else if (data.items.length === 0)
    body =
      q || filter !== 'all' ? (
        <EmptyState icon={<Icon name="search" size={28} color={colors.muted} />} title={s.noMatch} body={s.noMatchBody} />
      ) : (
        <EmptyState
          icon={<Icon name="users" size={28} color={colors.muted} />}
          title={s.empty}
          body={s.emptyBody}
          action={<Button title={s.add} onPress={() => setAdding(true)} />}
        />
      );
  else
    body = (
      <>
        <Card className="overflow-hidden">
          {data.items.map((c, i) => (
            <CustomerRow key={c.id} c={c} last={i === data.items.length - 1} />
          ))}
        </Card>
        {data.items.length < data.total ? (
          <Button variant="secondary" title={s.loadMore} loading={list.isFetching} onPress={() => setLimit((n) => n + PAGE)} />
        ) : null}
      </>
    );

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      <View className="flex-row items-center gap-3 border-b border-border bg-card px-4 py-3">
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/bookings'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="h-11 w-11 items-center justify-center rounded-button border border-border bg-card active:bg-pressed"
        >
          <Icon name="chevron-left" color={colors.text} />
        </Pressable>
        <View className="min-w-0 flex-1">
          <Text className="text-[16px] font-extrabold">{s.title}</Text>
          {data ? <Text className="text-[12px] text-muted">{s.count(data.total)}</Text> : null}
        </View>
        <HeaderIconButton icon="plus" label={s.add} onPress={() => setAdding(true)} />
      </View>

      <ScrollView
        contentContainerClassName="gap-3 px-4 pb-8 pt-3.5"
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}
      >
        <View className="h-[46px] flex-row items-center gap-2 rounded-button border border-input-border bg-card px-3">
          <Icon name="search" size={20} color={colors.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={s.search}
            placeholderTextColor={colors.muted}
            accessibilityLabel={s.search}
            autoCorrect={false}
            returnKeyType="search"
            className="h-10 min-w-0 flex-1 font-sans text-[15px] text-text"
          />
          {text ? (
            <Pressable
              onPress={() => setText('')}
              accessibilityRole="button"
              accessibilityLabel={s.clear}
              hitSlop={6}
              className="h-8 w-8 items-center justify-center rounded-full bg-neutral-bg"
            >
              <Icon name="x" size={16} color={colors['neutral-fg']} />
            </Pressable>
          ) : null}
        </View>
        <View className="flex-row flex-wrap gap-2">
          {CUSTOMER_FILTERS.map((f) => (
            <Chip
              key={f}
              role="radio"
              label={s.filters[f]}
              selected={filter === f}
              onPress={() => {
                setFilter(f);
                setLimit(PAGE);
              }}
            />
          ))}
        </View>
        {body}
      </ScrollView>

      <CustomerSheet visible={adding} onClose={() => setAdding(false)} />
    </SafeAreaView>
  );
}

function CustomerRow({ c, last }: { c: CustomerSummary; last: boolean }) {
  const parts = [
    c.phone ? formatPhone(c.phone) : s.noPhone,
    c.visits ? s.visits(c.visits) : s.noVisits,
    c.lastVisitAt ? s.lastVisit(format(new Date(c.lastVisitAt), 'd MMM')) : null,
  ].filter(Boolean);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/bookings/customers/[id]', params: { id: String(c.id) } })}
      accessibilityRole="button"
      className={`min-h-[60px] flex-row items-center gap-3 px-3.5 py-3 active:bg-pressed ${last ? '' : 'border-b border-border'}`}
    >
      <CustomerAvatar name={c.name} tag={c.tag} />
      <View className="min-w-0 flex-1">
        <Text className="text-[14px] font-bold" numberOfLines={1}>
          {c.name}
        </Text>
        <Text className="text-[12px] text-muted" numberOfLines={1}>
          {parts.join(' · ')}
        </Text>
      </View>
      <CustomerTagView c={c} />
    </Pressable>
  );
}
