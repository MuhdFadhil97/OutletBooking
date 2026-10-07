import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { PublicBookingField } from '@outletbooking/shared';
import { Chip } from '@/components/ui/Chip';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';

export function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="text-[13px] font-bold text-label">{label}</Text>
      <View className="flex-row flex-wrap gap-2">{children}</View>
    </View>
  );
}

/** One booking question (custom field), used by the owner form and the public booking page. */
export function FieldInput({
  field,
  value,
  onChange,
  optionalHint,
}: {
  field: PublicBookingField;
  value: string;
  onChange: (v: string) => void;
  /** Shown after optional questions' labels, e.g. "(optional)". Required ones get "*" otherwise. */
  optionalHint?: string;
}) {
  const label = optionalHint
    ? field.isRequired
      ? field.label
      : `${field.label} ${optionalHint}`
    : field.isRequired
      ? `${field.label} *`
      : field.label;
  if (field.fieldType === 'select') {
    return (
      <ChipGroup label={label}>
        {(field.options ?? []).map((o) => (
          <Chip key={o} role="radio" label={o} selected={value === o} onPress={() => onChange(value === o ? '' : o)} />
        ))}
      </ChipGroup>
    );
  }
  return (
    <TextField
      compact
      label={label}
      value={value}
      onChangeText={onChange}
      keyboardType={field.fieldType === 'number' ? 'numeric' : field.fieldType === 'phone' ? 'phone-pad' : 'default'}
      multiline={field.fieldType === 'address'}
      placeholder={field.fieldType === 'date' ? 'YYYY-MM-DD' : undefined}
      maxLength={500}
    />
  );
}

/** Answers typed as text → API values (numbers for number questions). Returns an error message on bad input. */
export function fieldAnswers(
  fields: PublicBookingField[],
  answers: Record<string, string>,
): Record<string, string | number> | string {
  const out: Record<string, string | number> = {};
  for (const f of fields) {
    const v = answers[f.fieldKey]?.trim();
    if (!v) continue;
    if (f.fieldType === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) return `${f.label}: enter a number`;
      out[f.fieldKey] = n;
    } else out[f.fieldKey] = v;
  }
  return out;
}
