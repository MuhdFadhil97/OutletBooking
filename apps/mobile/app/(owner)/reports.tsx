import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { format, parseISO } from 'date-fns';
import { REPORT_PERIODS, type Report, type ReportPeriod } from '@outletbooking/shared';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { useMe } from '@/features/me/hooks';
import { useReport } from '@/features/reports/hooks';
import { formatRM } from '@/lib/format';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.reports;
const BAR_MAX = 96;

const percent = (rate: number | null) => (rate === null ? '–' : `${Math.round(rate * 1000) / 10}%`);
const hours = (min: number) => String(Math.round(min / 6) / 10);

function rangeTitle(r: Report): string {
  const from = parseISO(r.from);
  const to = parseISO(r.to);
  if (r.period === 'today') return format(from, 'EEE, d MMM yyyy');
  if (r.period === 'month') return format(from, 'MMMM yyyy');
  return from.getMonth() === to.getMonth()
    ? `${format(from, 'd')} – ${format(to, 'd MMM yyyy')}`
    : `${format(from, 'd MMM')} – ${format(to, 'd MMM yyyy')}`;
}

/** O8 · Reports: revenue, bookings, no-shows, utilisation; bookings per day, top services (FR-13). */
export default function ReportsScreen() {
  const [period, setPeriod] = useState<ReportPeriod>('week');
  const [offset, setOffset] = useState(0);
  const report = useReport(period, offset);
  const { me } = useMe();
  const label = me?.business.resourceLabel ?? 'Resource';

  useFocusEffect(
    useCallback(() => {
      void report.refetch();
    }, [report.refetch]), // eslint-disable-line react-hooks/exhaustive-deps
  );

  const r = report.data;
  let body;
  if (report.error && !r) body = <ErrorState error={report.error} onRetry={() => void report.refetch()} />;
  else if (!r) body = <LoadingState />;
  else body = <ReportBody r={r} offset={offset} label={label} />;

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      <ScrollView
        contentContainerClassName="gap-3.5 px-4 pb-8 pt-3"
        refreshControl={<RefreshControl refreshing={report.isRefetching} onRefresh={() => void report.refetch()} tintColor={colors.primary} />}
      >
        <Text className="pt-1 text-[24px] font-extrabold">{t.tabs.reports}</Text>
        <View className="flex-row flex-wrap gap-2">
          {REPORT_PERIODS.map((p) => (
            <Chip
              key={p}
              role="radio"
              label={s.periods[p]}
              selected={period === p && offset === 0}
              onPress={() => {
                setPeriod(p);
                setOffset(0);
              }}
            />
          ))}
        </View>
        <View className="flex-row items-center gap-2">
          <StepButton icon="chevron-left" label={s.previous} onPress={() => setOffset((n) => n - 1)} disabled={offset <= -36} />
          <Text className="flex-1 text-center text-[15px] font-bold">{r ? rangeTitle(r) : ''}</Text>
          <StepButton icon="chevron-right" label={s.next} onPress={() => setOffset((n) => n + 1)} disabled={offset >= 12} />
        </View>
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

function StepButton({ icon, label, onPress, disabled }: { icon: 'chevron-left' | 'chevron-right'; label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`h-11 w-11 items-center justify-center rounded-button border border-border bg-card active:bg-pressed ${disabled ? 'opacity-40' : ''}`}
    >
      <Icon name={icon} color={colors.text} />
    </Pressable>
  );
}

function ReportBody({ r, offset, label }: { r: Report; offset: number; label: string }) {
  const vs = offset === 0 ? s.vs[r.period] : s.vsBefore[r.period];
  const revenueTrend =
    r.prevRevenueSen > 0 ? s.trend(s.pct(Math.round(((r.revenueSen - r.prevRevenueSen) / r.prevRevenueSen) * 100)), vs) : null;
  const u = r.utilisation;
  const kpis = [
    { value: formatRM(r.revenueSen), label: s.revenue, note: revenueTrend },
    { value: String(r.bookings), label: s.bookings, note: s.trend(s.delta(r.bookings - r.prevBookings), vs) },
    { value: percent(r.noShowRate), label: s.noShowRate, note: s.noShows(r.noShows) },
    { value: percent(u.rate), label: s.utilisation(label), note: u.openMin ? s.hoursBooked(hours(u.bookedMin), hours(u.openMin)) : s.noHours },
  ];
  const nothing = r.bookings === 0 && r.statuses.cancelled === 0;

  return (
    <>
      <View className="flex-row flex-wrap gap-2.5">
        {kpis.map((k) => (
          <Card key={k.label} className="basis-[46%] grow gap-0.5 p-3">
            <Text className="text-[20px] font-extrabold">{k.value}</Text>
            <Text className="text-[12px] font-semibold text-muted">{k.label}</Text>
            {k.note ? <Text className="text-[12px] font-bold text-ok-fg">{k.note}</Text> : null}
          </Card>
        ))}
      </View>

      {nothing ? (
        <Card>
          <EmptyState icon={<Icon name="chart" size={28} color={colors.muted} />} title={s.empty} body={s.emptyBody} />
        </Card>
      ) : (
        <>
          {r.period === 'today' ? <StatusSummary r={r} /> : <PerDayChart r={r} />}
          {r.topServices.length ? (
            <BarList title={s.topServices} rows={r.topServices.map((x) => ({ key: x.id, name: x.name, value: x.bookings, display: String(x.bookings) }))} />
          ) : null}
        </>
      )}

      {u.resources.length > 1 ? (
        <BarList
          title={s.byResource(label)}
          max={1}
          rows={u.resources.map((x) => ({ key: x.id, name: x.name, value: x.rate ?? 0, display: percent(x.rate) }))}
        />
      ) : null}

      <Card className="gap-2 p-3.5">
        <Text className="text-[14px] font-extrabold">{s.money}</Text>
        <Line label={s.collected} value={formatRM(r.collectedSen)} />
        <Line label={s.refunded} value={formatRM(r.refundedSen)} />
        <Text className="text-[12px] text-muted">{s.moneyNote}</Text>
      </Card>

      <Card className="gap-2 p-3.5">
        <Text className="text-[14px] font-extrabold">{s.customers}</Text>
        <Line label={s.newCustomers} value={String(r.customers.new)} />
        <Line label={s.returning} value={String(r.customers.returning)} />
      </Card>
    </>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-[14px]">{label}</Text>
      <Text className="text-[14px] font-bold">{value}</Text>
    </View>
  );
}

/** FR-13.1: today's bookings by status. */
function StatusSummary({ r }: { r: Report }) {
  const keys = ['upcoming', 'checkedIn', 'completed', 'noShow', 'cancelled'] as const;
  return (
    <Card className="gap-2 p-3.5">
      <Text className="text-[14px] font-extrabold">{s.summary}</Text>
      {keys.map((k) => (
        <Line key={k} label={s.statuses[k]} value={String(r.statuses[k])} />
      ))}
    </Card>
  );
}

/** Week: Mon…Sun labels. Month: one thin bar per day, a label every 7 days. Today and later are lighter. */
function PerDayChart({ r }: { r: Report }) {
  const max = Math.max(1, ...r.perDay.map((d) => d.bookings));
  const week = r.period === 'week';
  const lighter = r.perDay.some((d) => d.date >= r.today);
  return (
    <Card className="gap-2.5 p-3.5">
      <Text className="text-[14px] font-extrabold">{s.perDay}</Text>
      <View className={`flex-row items-end ${week ? 'gap-2.5' : 'gap-[3px]'}`} style={{ height: BAR_MAX + 24 }}>
        {r.perDay.map((d, i) => {
          const date = parseISO(d.date);
          const showLabel = week || i % 7 === 0;
          return (
            <View
              key={d.date}
              className="flex-1 items-center justify-end gap-1.5"
              accessible
              accessibilityLabel={`${format(date, 'EEEE d MMMM')}: ${d.bookings}`}
            >
              {week && d.bookings ? <Text className="text-[11px] font-bold text-muted">{d.bookings}</Text> : null}
              <View
                className={`w-full ${week ? 'rounded-t-md' : 'rounded-t-sm'}`}
                style={{
                  height: d.bookings ? Math.max(4, Math.round((d.bookings / max) * BAR_MAX)) : 2,
                  backgroundColor: d.bookings ? (d.date >= r.today ? colors['primary-light'] : colors.primary) : colors['neutral-bg'],
                }}
              />
              <Text className="text-[11px] font-bold text-muted" numberOfLines={1}>
                {showLabel ? (week ? format(date, 'EEE') : format(date, 'd')) : ' '}
              </Text>
            </View>
          );
        })}
      </View>
      {lighter ? <Text className="text-[12px] text-muted">{s.perDayNote}</Text> : null}
    </Card>
  );
}

function BarList({ title, rows, max }: { title: string; rows: { key: number; name: string; value: number; display: string }[]; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((x) => x.value));
  return (
    <Card className="gap-1 px-3.5 py-3">
      <Text className="pb-1 text-[14px] font-extrabold">{title}</Text>
      {rows.map((x) => (
        <View key={x.key} className="min-h-[32px] flex-row items-center gap-2.5">
          <Text className="w-[96px] text-[14px]" numberOfLines={1}>
            {x.name}
          </Text>
          <View className="h-2 flex-1 rounded bg-neutral-bg">
            <View className="h-2 rounded bg-primary" style={{ width: `${Math.min(100, (x.value / top) * 100)}%` }} />
          </View>
          <Text className="w-[48px] text-right text-[14px] font-bold">{x.display}</Text>
        </View>
      ))}
    </Card>
  );
}
