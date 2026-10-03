import { useEffect, useState } from 'react';
import { parseRinggit, senToInput } from '@/lib/format';
import { TextField } from './TextField';

/**
 * Ringgit input that stores integer sen. Invalid text reports NaN so the zod
 * schema (integer sen) shows the error instead of silently saving 0.
 */
export function MoneyField({
  label,
  valueSen,
  onChangeSen,
  error,
  hint,
}: {
  label: string;
  valueSen: number;
  onChangeSen: (sen: number) => void;
  error?: string;
  hint?: string;
}) {
  const [text, setText] = useState(() => (Number.isFinite(valueSen) ? senToInput(valueSen) : ''));

  // Follow outside changes (form reset) without fighting the user's typing.
  useEffect(() => {
    if (Number.isFinite(valueSen) && parseRinggit(text) !== valueSen) setText(senToInput(valueSen));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueSen]);

  return (
    <TextField
      compact
      label={label}
      prefix="RM "
      value={text}
      keyboardType="decimal-pad"
      onChangeText={(v) => {
        setText(v);
        onChangeSen(parseRinggit(v) ?? Number.NaN);
      }}
      error={error}
      hint={hint}
    />
  );
}
