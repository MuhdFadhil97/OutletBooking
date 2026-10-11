import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { LISTING_FILTERS, type Listing, type ListingFilter } from '@outletbooking/shared';
import { HeaderIconButton } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Tag, type TagTone } from '@/components/ui/Tag';
import { Text } from '@/components/ui/Text';
import { useListings, useToggleListing } from '@/features/listings/hooks';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.listings;
const TONE: Record<Listing['status'], TagTone> = { available: 'ok', under_offer: 'pending', closed: 'neutral' };

const openListing = (id: number | 'new') => router.push({ pathname: '/setup/listings/[id]', params: { id: String(id) } });

/** ST-RE-L · Listings: search, status filter, open-for-viewings switch. */
export default function ListingsScreen() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ListingFilter>('all');
  const list = useListings(q, status);
  const toggle = useToggleListing();

  // Search 300 ms after typing stops.
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300);
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
  else if (data.listings.length === 0)
    body =
      q || status !== 'all' ? (
        <EmptyState icon={<Icon name="search" size={28} color={colors.muted} />} title={s.noMatch} body={s.noMatchBody} />
      ) : (
        <EmptyState
          icon={<Icon name="building" size={28} color={colors.muted} />}
          title={s.empty}
          body={s.emptyBody}
          action={<Button title={s.add} onPress={() => openListing('new')} />}
        />
      );
  else
    body = (
      <Card className="overflow-hidden">
        {data.listings.map((l, i) => (
          <ListingRow
            key={l.id}
            l={l}
            last={i === data.listings.length - 1}
            onToggle={(open) => toggle.mutate({ id: l.id, openForViewings: open })}
          />
        ))}
      </Card>
    );

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      <View className="flex-row items-center gap-3 border-b border-border bg-card px-4 py-3">
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/setup'))}
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
        <HeaderIconButton icon="plus" label={s.add} onPress={() => openListing('new')} />
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
          {LISTING_FILTERS.map((f) => (
            <Chip key={f} role="radio" label={s.filters[f]} selected={status === f} onPress={() => setStatus(f)} />
          ))}
        </View>
        <FormError message={toggle.error ? errorMessage(toggle.error) : null} />
        {body}
        <Text className="text-[13px] text-muted">{s.note}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function ListingRow({ l, last, onToggle }: { l: Listing; last: boolean; onToggle: (open: boolean) => void }) {
  const meta = [`[${l.ref}]`, l.area, l.agent?.name].filter(Boolean).join(' · ');
  return (
    <View className={`flex-row items-center gap-3 px-3.5 py-3 ${last ? '' : 'border-b border-border'}`}>
      <Pressable
        onPress={() => openListing(l.id)}
        accessibilityRole="button"
        className="min-h-[56px] min-w-0 flex-1 flex-row items-center gap-3 active:opacity-70"
      >
        <View className="h-12 w-12 items-center justify-center rounded-[10px] bg-soft">
          <Icon name="building" size={22} color={colors.primary} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-[14px] font-bold" numberOfLines={1}>
            {l.title}
          </Text>
          <Text className="text-[12px] text-muted" numberOfLines={1}>
            {meta}
          </Text>
          <View className="flex-row flex-wrap items-center gap-2">
            <Tag label={s.status[l.status]} tone={TONE[l.status]} />
            <Text className="text-[12px] text-muted">{l.bookable ? s.viewings(l.viewingCount) : s.paused}</Text>
          </View>
        </View>
      </Pressable>
      <Switch
        value={l.openForViewings}
        onValueChange={onToggle}
        disabled={l.status === 'closed'}
        accessibilityLabel={s.openSwitch(l.title)}
        trackColor={{ true: colors.primary, false: '#B8C1BC' }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}
