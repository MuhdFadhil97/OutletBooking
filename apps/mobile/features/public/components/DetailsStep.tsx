import { Pressable, View } from 'react-native';
import type { PublicBookingField, PublicBusiness, PublicService } from '@outletbooking/shared';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { formatDuration, formatRM } from '@/lib/format';
import { t } from '@/strings/en';

const b = t.book;

export interface DetailsValue {
  name: string;
  phone: string;
  address: string;
  notes: string;
  answers: Record<string, string>;
  agreed: boolean;
}

/** What the customer pays online now vs later, from the slot price and the service's payment rule. */
export function paymentPlan(svc: PublicService, priceSen: number) {
  if (priceSen === 0) return { kind: 'free' as const, nowSen: 0, laterSen: 0 };
  if (svc.prepayFull) return { kind: 'full' as const, nowSen: priceSen, laterSen: 0 };
  if (svc.depositSen > 0) {
    const nowSen = svc.priceUnit === 'per_block' ? svc.depositSen : Math.min(svc.depositSen, priceSen);
    return { kind: 'deposit' as const, nowSen, laterSen: Math.max(0, priceSen - nowSen) };
  }
  return { kind: 'at_visit' as const, nowSen: 0, laterSen: priceSen };
}

/** C3 / C5 / C6b · contact details, the business's questions, payment summary, cancellation policy. */
export function DetailsStep({
  biz,
  service,
  fields,
  priceSen,
  value,
  onChange,
  errors,
}: {
  biz: PublicBusiness;
  service: PublicService;
  fields: PublicBookingField[];
  priceSen: number;
  value: DetailsValue;
  onChange: (patch: Partial<DetailsValue>) => void;
  errors: Partial<Record<string, string>>;
}) {
  const plan = paymentPlan(service, priceSen);
  const setAnswer = (key: string, v: string) => onChange({ answers: { ...value.answers, [key]: v } });
  const policy = biz.cancelPolicy.customersCanCancel
    ? [b.policyFree(formatDuration(biz.cancelPolicy.cancelCutoffMin)), plan.kind === 'deposit' && biz.cancelPolicy.lateCancelKeepsDeposit ? b.policyKeep : null]
        .filter(Boolean)
        .join(' ')
    : b.policyNone;

  return (
    <View className="gap-4">
      <Card className="gap-4 p-4">
        <TextField compact label={b.fullName} value={value.name} onChangeText={(name) => onChange({ name })} error={errors.name} autoCapitalize="words" autoComplete="name" />
        <TextField
          compact
          label={b.mobile}
          value={value.phone}
          onChangeText={(phone) => onChange({ phone })}
          error={errors.phone}
          hint={b.mobileHint}
          keyboardType="phone-pad"
          autoComplete="tel"
          placeholder="012-345 6789"
        />
        {service.locationType === 'at_customer_location' ? (
          <TextField
            compact
            label={b.address}
            value={value.address}
            onChangeText={(address) => onChange({ address })}
            error={errors.address}
            hint={biz.settings.mobileFeeSen ? b.mobileFee(formatRM(biz.settings.mobileFeeSen)) : b.addressHint}
            multiline
          />
        ) : null}
        {fields.map((f) => (
          <Question key={f.fieldKey} field={f} value={value.answers[f.fieldKey] ?? ''} onChange={(v) => setAnswer(f.fieldKey, v)} error={errors[f.fieldKey]} />
        ))}
        <TextField compact label={`${b.message} ${b.optional}`} value={value.notes} onChangeText={(notes) => onChange({ notes })} hint={b.messageHint} multiline />
      </Card>

      <Card className="gap-2 p-4">
        {plan.kind === 'free' ? (
          <Text className="text-[15px] font-bold">{b.freeBooking}</Text>
        ) : (
          <>
            <View className="flex-row justify-between">
              <Text className="text-[15px] font-bold">
                {plan.kind === 'full' ? b.payNowFull : plan.kind === 'deposit' ? b.payNowDeposit : b.payAtVisit}
              </Text>
              <Text className="text-[15px] font-extrabold">{formatRM(plan.kind === 'at_visit' ? plan.laterSen : plan.nowSen)}</Text>
            </View>
            {plan.kind === 'deposit' && plan.laterSen ? <Text className="text-[13px] text-muted">{b.balanceLater(formatRM(plan.laterSen))}</Text> : null}
            {plan.nowSen > 0 ? <Text className="text-[13px] text-muted">{b.holdNote(biz.pendingExpiryMin)}</Text> : null}
          </>
        )}
      </Card>

      <Pressable
        onPress={() => onChange({ agreed: !value.agreed })}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: value.agreed }}
        className="min-h-[44px] flex-row items-start gap-3"
      >
        <View className={`mt-0.5 h-6 w-6 items-center justify-center rounded-[6px] border-2 ${value.agreed ? 'border-primary bg-primary' : 'border-input-border bg-card'}`}>
          {value.agreed ? <Icon name="check" size={16} color="#FFFFFF" /> : null}
        </View>
        <Text className="flex-1 text-[13px] text-label">{b.agree(policy)}</Text>
      </Pressable>
      {errors.agreed ? <Text className="text-[12px] font-bold text-danger">{errors.agreed}</Text> : null}
    </View>
  );
}

function Question({ field, value, onChange, error }: { field: PublicBookingField; value: string; onChange: (v: string) => void; error?: string }) {
  const label = field.isRequired ? field.label : `${field.label} ${b.optional}`;
  if (field.fieldType === 'select') {
    return (
      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{label}</Text>
        <View className="flex-row flex-wrap gap-2">
          {(field.options ?? []).map((o) => (
            <Chip key={o} role="radio" label={o} selected={value === o} onPress={() => onChange(o)} />
          ))}
        </View>
        {error ? <Text className="text-[12px] font-bold text-danger">{error}</Text> : null}
      </View>
    );
  }
  return (
    <TextField
      compact
      label={label}
      value={value}
      onChangeText={onChange}
      error={error}
      placeholder={field.hint ?? undefined}
      keyboardType={field.fieldType === 'number' ? 'numeric' : field.fieldType === 'phone' ? 'phone-pad' : 'default'}
      multiline={field.fieldType === 'address'}
      autoCapitalize={field.fieldKey.includes('plate') ? 'characters' : 'sentences'}
    />
  );
}

