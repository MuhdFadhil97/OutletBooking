import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { formatInTimeZone } from 'date-fns-tz';
import { CHECK_OUTCOMES, OVERALL_RESULTS, type Booking, type CheckOutcome, type InspectionSection } from '@outletbooking/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { whatsappUrl } from '@/features/bookings/format';
import { t } from '@/strings/en';
import { colors } from '@/theme';
import { useInspection, useReportLink, useSaveInspection } from '../hooks';

const s = t.inspection;

/** Selected colours per outcome (wireframe Pass / Needs attention / Fail). */
const OUTCOME_ON: Record<CheckOutcome, string> = {
  pass: 'border-ok-fg bg-ok-bg',
  attention: 'border-pend-fg bg-pend-bg',
  fail: 'border-danger bg-danger-tint',
  na: 'border-neutral-fg bg-neutral-bg',
};
const OUTCOME_TEXT: Record<CheckOutcome, string> = {
  pass: 'text-ok-fg',
  attention: 'text-pend-fg',
  fail: 'text-danger',
  na: 'text-neutral-fg',
};

/**
 * S2 · vehicle inspection: overall result, Pass / Needs attention / Fail / N/A per check (saved on tap),
 * and "Send report on WhatsApp". Used by the staff job screen and the owner's booking detail.
 */
export function InspectionCard({
  booking,
  businessName,
  tz,
  disabled,
}: {
  booking: Booking;
  businessName: string;
  tz: string;
  disabled: boolean;
}) {
  const inspection = useInspection(booking.id);
  const save = useSaveInspection(booking.id);
  const report = useReportLink(booking.id);

  if (!inspection.data) {
    return (
      <Card className="p-3.5">
        {inspection.error ? <ErrorState error={inspection.error} onRetry={() => void inspection.refetch()} /> : <LoadingState />}
      </Card>
    );
  }
  const insp = inspection.data;
  const phone = booking.customer.phone;

  const sendReport = () =>
    report.mutate(undefined, {
      onSuccess: (link) => {
        if (!phone) return;
        const text = s.reportMessage(booking.customer.name, businessName, link.reportUrl);
        void Linking.openURL(`${whatsappUrl(phone)}?text=${encodeURIComponent(text)}`);
      },
    });

  return (
    <>
      <Card className="gap-2.5 p-3.5">
        <Text className="text-[12px] font-extrabold uppercase tracking-[0.6px] text-muted">{s.overall}</Text>
        <View className="flex-row gap-2">
          {OVERALL_RESULTS.map((o) => {
            const on = insp.overall === o;
            return (
              <Pressable
                key={o}
                onPress={() => save.mutate({ overall: on ? null : o })}
                disabled={disabled}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, disabled }}
                className={`min-h-[44px] flex-1 items-center justify-center rounded-button border px-2 ${
                  on ? OUTCOME_ON[o] : 'border-input-border bg-card active:bg-pressed'
                } ${disabled ? 'opacity-50' : ''}`}
              >
                <Text className={`text-center text-[13px] font-bold ${on ? OUTCOME_TEXT[o] : 'text-text'}`}>{s.outcomes[o]}</Text>
              </Pressable>
            );
          })}
        </View>
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </Card>

      {insp.sections.length ? (
        insp.sections.map((section) => (
          <SectionCard
            key={section.id}
            section={section}
            disabled={disabled}
            onPick={(itemId, outcome) => save.mutate({ items: [{ itemId, outcome }] })}
          />
        ))
      ) : (
        <Card className="p-3.5">
          <Text className="text-[13px] text-muted">{s.noChecklist}</Text>
        </Card>
      )}

      {insp.reportWhatsapp && phone ? (
        <View className="gap-1.5">
          <FormError message={report.error ? errorMessage(report.error) : null} />
          <Button
            variant={insp.reportSentAt ? 'secondary' : 'primary'}
            title={insp.reportSentAt ? s.sendAgain : s.sendReport}
            loading={report.isPending}
            disabled={disabled || !insp.overall}
            onPress={sendReport}
          />
          <Text className="text-center text-[12px] text-muted">
            {!insp.overall
              ? s.needsOverall
              : insp.reportSentAt
                ? s.reportSent(formatInTimeZone(new Date(insp.reportSentAt), tz, 'd MMM, h:mm a'))
                : ''}
          </Text>
        </View>
      ) : null}
    </>
  );
}

function SectionCard({
  section,
  disabled,
  onPick,
}: {
  section: InspectionSection;
  disabled: boolean;
  onPick: (itemId: number, outcome: CheckOutcome) => void;
}) {
  const done = section.items.filter((i) => i.outcome !== null).length;
  const [open, setOpen] = useState(done < section.items.length);
  return (
    <Card className="overflow-hidden">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="min-h-[52px] flex-row items-center gap-3 px-3.5 py-3 active:bg-pressed"
      >
        <View className="flex-1">
          <Text className="text-[15px] font-bold">{section.name}</Text>
          <Text className="text-[12px] text-muted">{s.progress(done, section.items.length)}</Text>
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
      </Pressable>
      {open
        ? section.items.map((item) => (
            <View key={item.id} className="gap-2 border-t border-border px-3.5 py-3">
              <Text className="text-[14px] font-semibold">{item.label}</Text>
              <View className="flex-row flex-wrap gap-1.5">
                {CHECK_OUTCOMES.map((o) => (
                  <Chip
                    key={o}
                    role="radio"
                    label={s.short[o]}
                    selected={item.outcome === o}
                    disabled={disabled}
                    onPress={() => onPick(item.id, o)}
                  />
                ))}
              </View>
              {item.note ? <Text className="text-[12px] text-muted">{item.note}</Text> : null}
            </View>
          ))
        : null}
    </Card>
  );
}
