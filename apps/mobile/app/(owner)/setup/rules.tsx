import { useEffect } from 'react';
import { View } from 'react-native';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { bookingRulesSchema, type BookingRulesInput, type BusinessProfile } from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChipChoice } from '@/components/ui/Chip';
import { SectionLabel, SwitchRow } from '@/components/ui/Rows';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { useBusiness, useUpdateBusiness } from '@/features/setup/hooks';
import { formatDuration } from '@/lib/format';
import { closeWith } from '@/lib/close-with';
import { t } from '@/strings/en';

const p = t.setup.profile;

const SLOT_INTERVALS = [15, 30, 60, 90, 120] as const;
const MIN_ADVANCE = [0, 30, 60, 120, 240, 1440] as const;
const MAX_DAYS = [7, 14, 30, 60, 90] as const;
const HOLD_UNPAID = [10, 15, 30, 60] as const;
const CANCEL_CUTOFF = [0, 60, 120, 1440, 2880] as const;

const ahead = (min: number) => (min === 0 ? p.none : p.ahead(formatDuration(min)));
const before = (min: number) => (min === 0 ? p.anytime : p.before(formatDuration(min)));

function toForm(b: BusinessProfile): BookingRulesInput {
  return {
    slotIntervalMin: b.slotIntervalMin,
    minAdvanceMin: b.minAdvanceMin,
    maxDaysAhead: b.maxDaysAhead,
    cancelCutoffMin: b.cancelCutoffMin,
    pendingExpiryMin: b.pendingExpiryMin,
    bookingEnabled: b.bookingEnabled,
    autoConfirmPaid: b.autoConfirmPaid,
    customersCanCancel: b.customersCanCancel,
    lateCancelKeepsDeposit: b.lateCancelKeepsDeposit,
  };
}

/** E6 · Booking rules: when customers can book, payment hold, cancelling. */
export default function RulesScreen() {
  const business = useBusiness();
  if (business.isPending) return <LoadingState />;
  if (business.error) return <ErrorState error={business.error} onRetry={() => void business.refetch()} />;
  return <RulesForm business={business.data} />;
}

function Chips<T extends number>({
  title,
  hint,
  options,
  value,
  onChange,
  format,
}: {
  title: string;
  hint?: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format: (v: T) => string;
}) {
  return (
    <View className="gap-2">
      <View className="gap-0.5">
        <Text className="text-[14px] font-semibold">{title}</Text>
        {hint ? <Text className="text-[12px] text-muted">{hint}</Text> : null}
      </View>
      <ChipChoice options={options} value={value} onChange={onChange} format={format} />
    </View>
  );
}

function RulesForm({ business }: { business: BusinessProfile }) {
  const save = useUpdateBusiness();
  const { control, handleSubmit, formState, reset } = useForm({
    resolver: zodResolver(bookingRulesSchema),
    defaultValues: toForm(business),
  });
  useEffect(() => reset(toForm(business)), [business, reset]);
  const [canCancel, cutoff, keepsDeposit] = useWatch({
    control,
    name: ['customersCanCancel', 'cancelCutoffMin', 'lateCancelKeepsDeposit'],
  });

  const onSave = handleSubmit((values) => save.mutate(values, { onSuccess: closeWith(t.common.saved) }));

  const chips = <K extends 'slotIntervalMin' | 'minAdvanceMin' | 'maxDaysAhead' | 'pendingExpiryMin' | 'cancelCutoffMin'>(
    name: K,
    title: string,
    options: readonly number[],
    format: (v: number) => string,
    hint?: string,
  ) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Chips title={title} hint={hint} options={options} value={field.value} onChange={field.onChange} format={format} />
      )}
    />
  );

  const toggle = (
    name: 'bookingEnabled' | 'autoConfirmPaid' | 'customersCanCancel' | 'lateCancelKeepsDeposit',
    label: string,
    hint: string,
  ) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => <SwitchRow label={label} hint={hint} value={field.value ?? false} onChange={field.onChange} />}
    />
  );

  return (
    <StackScreen
      title={p.rulesTitle}
      subtitle={p.rulesSub}
      footer={<Button title={p.saveRules} loading={save.isPending} disabled={!formState.isDirty} onPress={onSave} />}
    >
      <FormError message={save.error ? errorMessage(save.error) : null} />

      <Card className="p-4">{toggle('bookingEnabled', p.bookingEnabled, p.bookingEnabledHint)}</Card>

      <SectionLabel label={p.whenCanBook} />
      <Card className="gap-4 p-4">
        {chips('slotIntervalMin', p.slotInterval, SLOT_INTERVALS, formatDuration, p.slotIntervalHint)}
        {chips('minAdvanceMin', p.minAdvanceShort, MIN_ADVANCE, ahead, p.minAdvanceShortHint)}
        {chips('maxDaysAhead', p.maxDaysAhead, MAX_DAYS, p.days, p.maxDaysHint)}
      </Card>

      <SectionLabel label={p.payment} />
      <Card className="gap-4 p-4">
        {chips('pendingExpiryMin', p.holdUnpaid, HOLD_UNPAID, formatDuration, p.holdUnpaidHint)}
        {toggle('autoConfirmPaid', p.autoConfirmPaid, p.autoConfirmPaidHint)}
      </Card>

      <SectionLabel label={p.cancelling} />
      <Card className="gap-4 p-4">
        {toggle('customersCanCancel', p.customersCanCancel, p.customersCanCancelHint)}
        {canCancel ? (
          <>
            {chips('cancelCutoffMin', p.cancelUntil, CANCEL_CUTOFF, before, p.cancelCutoffHint)}
            {toggle('lateCancelKeepsDeposit', p.lateDeposit, p.lateCancelKeepsDepositHint)}
          </>
        ) : null}
        <View className="rounded-input bg-soft px-3 py-2.5">
          <Text className="text-[13px] text-label">
            {canCancel ? p.customersSee(before(cutoff ?? 0), !!keepsDeposit) : p.noCancelOnline}
          </Text>
        </View>
      </Card>
    </StackScreen>
  );
}
