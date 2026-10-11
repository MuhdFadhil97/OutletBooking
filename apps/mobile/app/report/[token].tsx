import { Image, Linking, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { formatInTimeZone } from 'date-fns-tz';
import type { CheckOutcome, OverallResult, PublicInspectionReport } from '@outletbooking/shared';
import { Brand } from '@/components/Brand';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ErrorState, LoadingState } from '@/components/ui/ScreenState';
import { Tag, type TagTone } from '@/components/ui/Tag';
import { Text } from '@/components/ui/Text';
import { whatsappUrl } from '@/features/bookings/format';
import { usePublicReport } from '@/features/inspections/hooks';
import { PublicPage, SummaryRow } from '@/features/public/components/PublicPage';
import { ApiError } from '@/lib/api';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.inspection;
const TONE: Record<CheckOutcome, TagTone> = { pass: 'ok', attention: 'pending', fail: 'danger', na: 'neutral' };
const OVERALL: Record<OverallResult, { icon: IconName; bg: string; fg: string }> = {
  pass: { icon: 'check', bg: 'bg-ok-bg', fg: colors['ok-fg'] },
  attention: { icon: 'help', bg: 'bg-pend-bg', fg: colors['pend-fg'] },
  fail: { icon: 'x', bg: 'bg-danger-tint', fg: colors.danger },
};

/** Vehicle inspection report the customer opens from WhatsApp (no login, by the booking's random token). */
export default function ReportPage() {
  const { token = '' } = useLocalSearchParams<{ token: string }>();
  const report = usePublicReport(token);

  if (report.isPending && /^[0-9a-f]{32}$/.test(token)) return <LoadingState />;
  if (!report.data) {
    const notFound = !report.error || (report.error instanceof ApiError && [400, 404].includes(report.error.status));
    if (!notFound) return <ErrorState error={report.error} onRetry={() => void report.refetch()} />;
    return (
      <PublicPage>
        <Brand />
        <Card className="gap-1 p-5">
          <Text className="text-[16px] font-extrabold">{s.notFound}</Text>
          <Text className="text-[14px] text-muted">{s.notFoundBody}</Text>
        </Card>
      </PublicPage>
    );
  }
  return (
    <>
      <Head>
        <title>{`${s.reportTitle} · ${report.data.business.name}`}</title>
      </Head>
      <Report r={report.data} />
    </>
  );
}

function Report({ r }: { r: PublicInspectionReport }) {
  const tz = r.business.timezone;
  const overall = OVERALL[r.overall];
  const contact = r.business.whatsappPhone ?? r.business.phone;
  return (
    <PublicPage
      footer={
        contact ? (
          <Button
            title={t.book.whatsappBusiness(r.business.name)}
            variant="secondary"
            onPress={() => void Linking.openURL(`${whatsappUrl(contact)}?text=${encodeURIComponent(`${s.reportTitle} ${r.ref}`)}`)}
          />
        ) : undefined
      }
    >
      <Brand right={r.ref} />
      <View className="items-center gap-2 py-2">
        <View className={`h-16 w-16 items-center justify-center rounded-full ${overall.bg}`}>
          <Icon name={overall.icon} size={30} color={overall.fg} />
        </View>
        <Text className="text-center text-[22px] font-extrabold">{s.outcomes[r.overall]}</Text>
        <Text className="text-center text-[14px] text-muted">
          {s.summaryCounts(r.counts.pass, r.counts.attention, r.counts.fail)}
        </Text>
      </View>

      <Card className="gap-2.5 p-4">
        <Text className="text-[16px] font-extrabold">{`${s.reportTitle} · ${r.business.name}`}</Text>
        <SummaryRow label={t.booking.service} value={r.serviceName} />
        {r.details.map((d) => (
          <SummaryRow key={d.label} label={d.label} value={d.value} />
        ))}
        <SummaryRow label={s.inspectedOn} value={formatInTimeZone(new Date(r.completedAt ?? r.startAt), tz, 'EEE, d MMM yyyy')} />
        {r.inspectorName ? <SummaryRow label={s.inspector} value={r.inspectorName} /> : null}
      </Card>

      {r.notes ? (
        <Card className="gap-1.5 p-4">
          <Text className="text-[12px] font-extrabold uppercase tracking-[0.6px] text-muted">{s.notes}</Text>
          <Text className="text-[14px] leading-5">{r.notes}</Text>
        </Card>
      ) : null}

      {r.sections.map((section) => (
        <Card key={section.name} className="overflow-hidden">
          <Text className="px-4 pb-1 pt-3 text-[12px] font-extrabold uppercase tracking-[0.6px] text-muted">{section.name}</Text>
          {section.items.map((item, i) => (
            <View key={`${item.label}-${i}`} className="gap-1 border-t border-border px-4 py-3">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="flex-1 text-[14px]">{item.label}</Text>
                <Tag label={s.outcomes[item.outcome]} tone={TONE[item.outcome]} />
              </View>
              {item.note ? <Text className="text-[13px] text-muted">{item.note}</Text> : null}
            </View>
          ))}
        </Card>
      ))}

      {r.photos.length ? (
        <View className="gap-2">
          <Text className="text-[12px] font-extrabold uppercase tracking-[0.6px] text-muted">{s.photos}</Text>
          <View className="flex-row flex-wrap gap-2">
            {r.photos.map((p) => (
              <Image
                key={p.url}
                source={{ uri: p.url }}
                accessibilityLabel={p.caption ?? s.photos}
                className="h-28 w-28 rounded-input bg-neutral-bg"
              />
            ))}
          </View>
        </View>
      ) : null}
    </PublicPage>
  );
}
