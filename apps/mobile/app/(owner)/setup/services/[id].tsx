import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  WEEKDAY_SHORT,
  serviceCreateSchema,
  type PriceRuleInput,
  type Service,
  type ServiceCreateInput,
} from '@outletbooking/shared';
import { HeaderIconButton, StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip, ChipChoice } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { MoneyField } from '@/components/ui/MoneyField';
import { RadioRow, SectionLabel, SwitchRow } from '@/components/ui/Rows';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { TimeSelect } from '@/components/ui/TimeSelect';
import { WEEK_ORDER, formatTimeRange, formatWeekdays, groupPriceRules } from '@/features/setup/format';
import { useArchiveService, useBusiness, useResources, useSaveService, useServices } from '@/features/setup/hooks';
import { confirm } from '@/lib/confirm';
import { formatDuration, formatRM } from '@/lib/format';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.setup.services;
const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240] as const;
const BUFFERS = [0, 5, 10, 15, 30, 60] as const;
const TRAVEL = [0, 15, 30, 45, 60] as const;

type Payment = 'full' | 'deposit' | 'venue';

function toForm(svc?: Service): ServiceCreateInput {
  return {
    name: svc?.name ?? '',
    description: svc?.description ?? '',
    durationMin: svc?.durationMin ?? 60,
    durationOptions: svc?.durationOptions ?? null,
    priceUnit: svc?.priceUnit ?? 'per_booking',
    priceSen: svc?.priceSen ?? 0,
    depositSen: svc?.depositSen ?? 0,
    prepayFull: svc?.prepayFull ?? false,
    bufferMin: svc?.bufferMin ?? 0,
    travelBufferMin: svc?.travelBufferMin ?? 0,
    locationType: svc?.locationType ?? 'at_business',
    isVisible: svc?.isVisible ?? true,
    sortOrder: svc?.sortOrder ?? 0,
    priceRules: (svc?.priceRules ?? []).map(({ id: _id, ...r }) => r),
    resourceIds: svc?.resourceIds ?? [],
  };
}

/** O5 · Edit service & pricing (duration options, peak rules, payment rule, resources). */
export default function ServiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const services = useServices();
  const resources = useResources();
  const business = useBusiness();

  if (services.isPending || resources.isPending || business.isPending) return <LoadingState />;
  const error = services.error ?? resources.error ?? business.error;
  if (error) return <ErrorState error={error} onRetry={() => void services.refetch()} />;

  const service = isNew ? undefined : services.data?.find((x) => x.id === Number(id));
  if (!isNew && !service) return <ErrorState error={null} onRetry={() => router.back()} />;

  return (
    <ServiceForm
      key={service?.id ?? 'new'}
      service={service}
      resources={resources.data ?? []}
      resourceLabel={business.data?.resourceLabel ?? 'Resource'}
      sortOrder={services.data?.length ?? 0}
    />
  );
}

function ServiceForm({
  service,
  resources,
  resourceLabel,
  sortOrder,
}: {
  service?: Service;
  resources: { id: number; name: string }[];
  resourceLabel: string;
  sortOrder: number;
}) {
  const save = useSaveService(service?.id ?? null);
  const archive = useArchiveService();
  const [ruleOpen, setRuleOpen] = useState(false);
  const [payment, setPayment] = useState<Payment>(
    service?.prepayFull ? 'full' : service?.depositSen ? 'deposit' : 'venue',
  );

  const { control, handleSubmit, formState, setValue } = useForm({
    resolver: zodResolver(serviceCreateSchema),
    mode: 'onTouched',
    defaultValues: { ...toForm(service), sortOrder: service?.sortOrder ?? sortOrder } as ServiceCreateInput,
  });
  const { errors } = formState;
  const [durationMin, durationOptions, priceUnit, locationType, priceRules] = useWatch({
    control,
    name: ['durationMin', 'durationOptions', 'priceUnit', 'locationType', 'priceRules'],
  });

  const choosable = [1, 2, 3, 4].map((n) => n * durationMin).filter((m) => m <= 1440);
  const toggleOption = (m: number) => {
    const current = durationOptions ?? [];
    const next = current.includes(m) ? current.filter((x) => x !== m) : [...current, m].sort((a, b) => a - b);
    setValue('durationOptions', next.length ? next : null, { shouldDirty: true, shouldValidate: true });
    if (next.length > 1 && priceUnit === 'per_booking') setValue('priceUnit', 'per_block', { shouldDirty: true });
  };

  const setPaymentRule = (p: Payment) => {
    setPayment(p);
    setValue('prepayFull', p === 'full', { shouldDirty: true });
    if (p !== 'deposit') setValue('depositSen', 0, { shouldDirty: true, shouldValidate: true });
  };

  const groups = groupPriceRules(
    (priceRules ?? []).map((r) => ({ ...r, name: r.name ?? 'Peak' })),
  );
  const removeGroup = (i: number) => {
    const g = groups[i]!;
    setValue(
      'priceRules',
      (priceRules ?? []).filter(
        (r) =>
          !(
            (r.name ?? 'Peak') === g.name &&
            r.startTime === g.startTime &&
            r.endTime === g.endTime &&
            r.priceSen === g.priceSen
          ),
      ),
      { shouldDirty: true },
    );
  };

  const onSave = handleSubmit((values) => save.mutate(values, { onSuccess: () => router.back() }));

  const onArchive = async () => {
    if (!service) return;
    if (!(await confirm(s.archiveTitle, s.archiveBody, t.setup.archive))) return;
    archive.mutate(service.id, { onSuccess: () => router.back() });
  };

  const blockLabel = formatDuration(durationMin).replace(/^1 /, '');

  return (
    <StackScreen
      title={service ? s.editTitle : s.newTitle}
      right={service ? <HeaderIconButton icon="trash" label={t.setup.archive} onPress={() => void onArchive()} danger /> : undefined}
      footer={<Button title={s.save} loading={save.isPending} onPress={onSave} />}
    >
      <FormError message={save.error ? errorMessage(save.error) : archive.error ? errorMessage(archive.error) : null} />

      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <TextField compact label={s.name} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.name?.message} />
        )}
      />
      <Controller
        control={control}
        name="description"
        render={({ field }) => (
          <TextField compact multiline label={s.description} value={field.value ?? ''} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.description?.message} />
        )}
      />

      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{s.block}</Text>
        <Text className="text-[12px] text-muted">{s.blockHint}</Text>
        <Controller
          control={control}
          name="durationMin"
          render={({ field }) => (
            <ChipChoice
              options={DURATIONS}
              value={field.value}
              onChange={(v) => {
                field.onChange(v);
                setValue('durationOptions', null, { shouldDirty: true }); // options are multiples of the block
              }}
              format={formatDuration}
            />
          )}
        />
      </View>

      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{s.choose}</Text>
        <Text className="text-[12px] text-muted">{s.chooseHint}</Text>
        <View className="flex-row flex-wrap gap-2">
          {choosable.map((m) => (
            <Chip key={m} label={formatDuration(m)} selected={!!durationOptions?.includes(m)} onPress={() => toggleOption(m)} />
          ))}
        </View>
        {errors.durationOptions?.message ? (
          <Text className="text-[12px] text-danger">{errors.durationOptions.message}</Text>
        ) : null}
      </View>

      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{s.priceUnit}</Text>
        <Controller
          control={control}
          name="priceUnit"
          render={({ field }) => (
            <View className="flex-row gap-2">
              <Chip role="radio" label={s.perBooking} selected={field.value === 'per_booking'} onPress={() => field.onChange('per_booking')} />
              <Chip role="radio" label={s.perBlock} selected={field.value === 'per_block'} onPress={() => field.onChange('per_block')} />
            </View>
          )}
        />
      </View>
      <Controller
        control={control}
        name="priceSen"
        render={({ field }) => (
          <MoneyField
            label={priceUnit === 'per_block' ? s.pricePerBlock(blockLabel) : s.price}
            valueSen={field.value ?? 0}
            onChangeSen={field.onChange}
            error={errors.priceSen ? 'Enter an amount like 30 or 30.50' : undefined}
          />
        )}
      />

      <Card className="gap-1 px-4 py-3">
        <SectionLabel label={s.peak} action={{ label: s.addRule, onPress: () => setRuleOpen(true) }} />
        {groups.length === 0 ? <Text className="pb-1 text-[14px] text-muted">{s.noRules}</Text> : null}
        {groups.map((g, i) => (
          <View key={`${g.name}${g.startTime}${g.priceSen}${i}`} className="flex-row items-center gap-2 py-2">
            <View className="flex-1">
              <Text className="text-[14px] font-semibold">
                {formatWeekdays(g.weekdays)} · {formatTimeRange(g.startTime, g.endTime)}
              </Text>
              <Text className="text-[12px] text-muted">{g.name}</Text>
            </View>
            <Text className="text-[14px] font-bold">
              {formatRM(g.priceSen)}
              {priceUnit === 'per_block' ? s.perBlockShort : ''}
            </Text>
            <Pressable
              onPress={() => removeGroup(i)}
              accessibilityRole="button"
              accessibilityLabel={`${t.setup.delete} ${g.name}`}
              className="h-11 w-11 items-center justify-center"
            >
              <Icon name="x" size={18} color={colors.muted} />
            </Pressable>
          </View>
        ))}
      </Card>

      <Card className="gap-1 px-4 py-3">
        <SectionLabel label={s.payment} />
        <RadioRow label={s.payFull} selected={payment === 'full'} onPress={() => setPaymentRule('full')} />
        <RadioRow label={s.payDeposit} hint={s.payDepositHint} selected={payment === 'deposit'} onPress={() => setPaymentRule('deposit')} />
        {payment === 'deposit' ? (
          <Controller
            control={control}
            name="depositSen"
            render={({ field }) => (
              <MoneyField label={s.deposit} valueSen={field.value ?? 0} onChangeSen={field.onChange} error={errors.depositSen?.message} />
            )}
          />
        ) : null}
        <RadioRow label={s.payVenue} selected={payment === 'venue'} onPress={() => setPaymentRule('venue')} />
      </Card>

      <Card className="gap-1 px-4 py-3">
        <SectionLabel label={s.location} />
        <Controller
          control={control}
          name="locationType"
          render={({ field }) => (
            <>
              <RadioRow label={s.atBusiness} selected={field.value === 'at_business'} onPress={() => field.onChange('at_business')} />
              <RadioRow label={s.atCustomer} selected={field.value === 'at_customer_location'} onPress={() => field.onChange('at_customer_location')} />
              <Text className="pb-1 text-[12px] text-muted">{s.atCustomerHint}</Text>
            </>
          )}
        />
        {locationType === 'at_customer_location' ? (
          <View className="gap-2 pb-2">
            <Text className="text-[13px] font-bold text-label">{s.travelBuffer}</Text>
            <Text className="text-[12px] text-muted">{s.travelBufferHint}</Text>
            <Controller
              control={control}
              name="travelBufferMin"
              render={({ field }) => (
                <ChipChoice options={TRAVEL} value={field.value ?? 0} onChange={field.onChange} format={(m) => (m ? `${m} min` : 'None')} />
              )}
            />
          </View>
        ) : null}
      </Card>

      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{s.buffer}</Text>
        <Text className="text-[12px] text-muted">{s.bufferHint}</Text>
        <Controller
          control={control}
          name="bufferMin"
          render={({ field }) => (
            <ChipChoice options={BUFFERS} value={field.value ?? 0} onChange={field.onChange} format={(m) => (m ? `${m} min` : 'None')} />
          )}
        />
      </View>

      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{s.resources(resourceLabel)}</Text>
        {resources.length === 0 ? (
          <Text className="text-[13px] text-muted">{s.noResources(resourceLabel)}</Text>
        ) : (
          <Controller
            control={control}
            name="resourceIds"
            render={({ field }) => (
              <View className="flex-row flex-wrap gap-2">
                {resources.map((r) => {
                  const ids = field.value ?? [];
                  const on = ids.includes(r.id);
                  return (
                    <Chip
                      key={r.id}
                      label={r.name}
                      selected={on}
                      onPress={() => field.onChange(on ? ids.filter((x) => x !== r.id) : [...ids, r.id])}
                    />
                  );
                })}
              </View>
            )}
          />
        )}
      </View>

      <Controller
        control={control}
        name="isVisible"
        render={({ field }) => <SwitchRow label={s.visible} value={field.value ?? true} onChange={field.onChange} />}
      />

      <PriceRuleSheet
        visible={ruleOpen}
        onClose={() => setRuleOpen(false)}
        onAdd={(rules) => {
          setValue('priceRules', [...(priceRules ?? []), ...rules], { shouldDirty: true });
          setRuleOpen(false);
        }}
      />
    </StackScreen>
  );
}

/** "Add rule" sheet: one rule for several weekdays → one row per weekday. */
function PriceRuleSheet({
  visible,
  onClose,
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (rules: PriceRuleInput[]) => void;
}) {
  const [name, setName] = useState('Peak');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('24:00');
  const [price, setPrice] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!days.length) return setError(s.ruleDaysError);
    if (end <= start) return setError(s.ruleTimeError);
    if (!Number.isInteger(price) || price < 0) return setError('Enter a valid price');
    setError(null);
    onAdd(days.map((weekday) => ({ name: name.trim() || 'Peak', weekday, startTime: start, endTime: end, priceSen: price })));
  };

  return (
    <Sheet visible={visible} title={s.ruleTitle} onClose={onClose}>
      <FormError message={error} />
      <TextField compact label={s.ruleName} value={name} onChangeText={setName} />
      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{s.ruleDays}</Text>
        <View className="flex-row flex-wrap gap-2">
          {WEEK_ORDER.map((d) => (
            <Chip
              key={d}
              label={WEEKDAY_SHORT[d]}
              selected={days.includes(d)}
              onPress={() => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))}
            />
          ))}
        </View>
      </View>
      <View className="flex-row items-end gap-3">
        <View className="gap-1.5">
          <Text className="text-[13px] font-bold text-label">{s.ruleFrom}</Text>
          <TimeSelect label={s.ruleFrom} value={start} onChange={setStart} />
        </View>
        <View className="gap-1.5">
          <Text className="text-[13px] font-bold text-label">{s.ruleTo}</Text>
          <TimeSelect label={s.ruleTo} value={end} onChange={setEnd} allowMidnightEnd min={start} />
        </View>
      </View>
      <MoneyField label={s.rulePrice} valueSen={price} onChangeSen={setPrice} />
      <Button title={s.ruleSave} onPress={submit} />
    </Sheet>
  );
}
