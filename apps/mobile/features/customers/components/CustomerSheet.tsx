import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { customerCreateSchema, normalizeMyPhone, type CustomerProfile } from '@outletbooking/shared';
import { Button } from '@/components/ui/Button';
import { FormError, errorMessage } from '@/components/ui/ScreenState';
import { Sheet } from '@/components/ui/Sheet';
import { TextField } from '@/components/ui/TextField';
import { showToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api';
import { t } from '@/strings/en';
import { useCreateCustomer, useUpdateCustomer } from '../hooks';

const s = t.customers;

/** Add a customer (D10 "+") or edit one (D11): name, mobile, email, notes. */
export function CustomerSheet({
  visible,
  customer,
  onClose,
}: {
  visible: boolean;
  /** Edit this customer; omit to add a new one. */
  customer?: CustomerProfile;
  onClose: () => void;
}) {
  const create = useCreateCustomer();
  const update = useUpdateCustomer(customer?.id ?? 0);
  const save = customer ? update : create;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!visible) return;
    setName(customer?.name ?? '');
    setPhone(customer?.phone ?? '');
    setEmail(customer?.email ?? '');
    setNotes(customer?.notes ?? '');
    setErrors({});
    create.reset();
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const submit = () => {
    const parsed = customerCreateSchema.safeParse({ name, phone: normalizeMyPhone(phone), email, notes });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    save.mutate(parsed.data, {
      onSuccess: (c) => {
        onClose();
        showToast({ message: customer ? s.saved : s.added });
        if (!customer) router.push({ pathname: '/bookings/customers/[id]', params: { id: String(c.id) } });
      },
    });
  };

  // "This mobile belongs to …" → offer to open that customer instead.
  const existingId =
    save.error instanceof ApiError && save.error.code === 'customer_exists'
      ? (save.error.details as { id?: number } | undefined)?.id
      : undefined;

  return (
    <Sheet visible={visible} title={customer ? s.editTitle : s.add} onClose={onClose}>
      <FormError message={existingId ? s.exists : save.error ? errorMessage(save.error) : null} />
      {existingId ? (
        <Button
          variant="secondary"
          title={s.openExisting}
          onPress={() => {
            onClose();
            router.push({ pathname: '/bookings/customers/[id]', params: { id: String(existingId) } });
          }}
        />
      ) : null}
      <TextField compact label={s.name} value={name} onChangeText={setName} maxLength={100} autoCapitalize="words" error={errors.name} />
      <TextField
        compact
        label={s.mobile}
        value={phone}
        onChangeText={setPhone}
        onBlur={() => setPhone(normalizeMyPhone(phone))}
        keyboardType="phone-pad"
        placeholder="+60 12-345 6789"
        error={errors.phone}
      />
      <TextField
        compact
        label={s.email}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        error={errors.email}
      />
      <TextField compact multiline label={s.notesLabel} value={notes} onChangeText={setNotes} maxLength={2000} error={errors.notes} />
      <Button title={s.save} loading={save.isPending} onPress={submit} />
    </Sheet>
  );
}
