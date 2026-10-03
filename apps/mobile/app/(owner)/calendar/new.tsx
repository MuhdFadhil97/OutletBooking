import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import {
  bookingCreateSchema,
  normalizeMyPhone,
  type AvailableSlot,
  type BookingCreateInput,
  type BookingField,
  type Service,
} from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { DateSelect } from '@/components/ui/DateSelect';
import { SectionLabel, SwitchRow } from '@/components/ui/Rows';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { TimeSelect } from '@/components/ui/TimeSelect';
import { todayIn } from '@/features/bookings/format';
import { useBooking, useCalendarAvailability, useCreateBooking, useRescheduleBooking } from '@/features/bookings/hooks';
import { useBookingFields, useBusiness, useResources, useServices } from '@/features/setup/hooks';
import { formatDuration, formatTime } from '@/lib/format';
import { t } from '@/strings/en';

const s = t.booking;

type Pick = { kind: 'slot'; slot: AvailableSlot } | { kind: 'custom' } | null;

/**
 * New booking from the calendar (FAB or tapping an empty spot), or reschedule (`bookingId`).
 * Times come from the free slots; "Pick another time" allows any start, optionally outside hours.
 */
export default function BookingFormScreen() {
  const params = useLocalSearchParams<{ date?: string; resourceId?: string; time?: string; bookingId?: string }>();
  const bookingId = params.bookingId ? Number(params.bookingId) : 0;
  const editing = bookingId > 0;

  const business = useBusiness();
  const services = useServices();
  const resources = useResources();
  const fields = useBookingFields();
  const existing = useBooking(bookingId);

  const ready = business.data && services.data && resources.data && fields.data && (!editing || existing.data);
  if (!ready) {
    const error = business.error ?? services.error ?? resources.error ?? fields.error ?? existing.error;
    return (
      <StackScreen title={editing ? s.rescheduleTitle : s.newTitle}>
        {error ? <ErrorState error={error} onRetry={() => void services.refetch()} /> : <LoadingState />}
      </StackScreen>
    );
  }
  return <BookingForm params={params} />;
}

function BookingForm({ params }: { params: { date?: string; resourceId?: string; time?: string; bookingId?: string } }) {
  const bookingId = params.bookingId ? Number(params.bookingId) : 0;
  const editing = bookingId > 0;
  const business = useBusiness().data!;
  const allServices = useServices().data!;
  const allResources = useResources().data!;
  const allFields = useBookingFields().data!;
  const existing = useBooking(bookingId).data;
  const tz = business.timezone;
  const create = useCreateBooking();
  const move = useRescheduleBooking(bookingId);

  const startLocal = existing ? formatInTimeZone(new Date(existing.startAt), tz, "yyyy-MM-dd'T'HH:mm") : null;
  const [serviceId, setServiceId] = useState<number>(
    existing?.service.id ?? allServices.find((x) => x.resourceIds.length > 0)?.id ?? allServices[0]?.id ?? 0,
  );
  const service = allServices.find((x) => x.id === serviceId);
  const [durationMin, setDurationMin] = useState<number>(existing?.durationMin ?? service?.durationMin ?? 60);
  const [resourceId, setResourceId] = useState<number | null>(
    existing?.resource.id ?? (params.resourceId ? Number(params.resourceId) : null),
  );
  const [date, setDate] = useState(startLocal?.slice(0, 10) ?? params.date ?? todayIn(tz));
  const [pick, setPick] = useState<Pick>(null);
  const [customTime, setCustomTime] = useState(startLocal?.slice(11, 16) ?? params.time ?? '09:00');
  const [outsideHours, setOutsideHours] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [walkIn, setWalkIn] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const offered = allResources.filter((r) => r.isActive && service?.resourceIds.includes(r.id));
  const durations = service?.durationOptions?.length ? service.durationOptions : service ? [service.durationMin] : [];
  const serviceFields = useMemo(
    () =>
      allFields
        .filter((f) => f.isActive && (f.serviceId === null || f.serviceId === serviceId))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [allFields, serviceId],
  );

  const availability = useCalendarAvailability(
    service && offered.length
      ? {
          serviceId,
          date,
          durationMin,
          resourceId: resourceId ?? undefined,
          excludeBookingId: editing ? bookingId : undefined,
        }
      : null,
  );
  const slots = availability.data?.slots ?? [];

  // A tapped calendar spot (or the booking being moved) preselects its time once slots arrive.
  const wantedTime = useRef(params.time ?? startLocal?.slice(11, 16) ?? null);
  useEffect(() => {
    if (!availability.data || wantedTime.current === null) return;
    const match = slots.find((x) => formatInTimeZone(new Date(x.startAt), tz, 'HH:mm') === wantedTime.current);
    setPick(match ? { kind: 'slot', slot: match } : { kind: 'custom' });
    wantedTime.current = null;
  }, [availability.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectService = (svc: Service) => {
    setServiceId(svc.id);
    setDurationMin(svc.durationMin);
    if (resourceId !== null && !svc.resourceIds.includes(resourceId)) setResourceId(null);
    setPick(null);
  };
  const resetPick = () => setPick((p) => (p?.kind === 'custom' ? p : null));
  const selectResource = (id: number | null) => {
    setResourceId(id);
    resetPick();
  };

  const startAt = (): string | null => {
    if (pick?.kind === 'slot') return pick.slot.startAt;
    if (pick?.kind === 'custom') return fromZonedTime(`${date}T${customTime}:00`, tz).toISOString();
    return null;
  };

  const customFields = (): Record<string, string | number> | string => {
    const out: Record<string, string | number> = {};
    for (const f of serviceFields) {
      const v = answers[f.fieldKey]?.trim();
      if (!v) continue;
      if (f.fieldType === 'number') {
        const n = Number(v);
        if (!Number.isFinite(n)) return `${f.label}: enter a number`;
        out[f.fieldKey] = n;
      } else out[f.fieldKey] = v;
    }
    return out;
  };

  const submit = () => {
    const start = startAt();
    if (!start) return setFormError(s.pickSlot);
    // "Any": a slot lists free resources least busy first; on a custom time the API picks (create)
    // or keeps the current resource (reschedule).
    const chosenResource = resourceId ?? (pick?.kind === 'slot' ? pick.slot.resourceIds[0] : undefined);

    if (editing) {
      setFormError(null);
      move.mutate(
        { startAt: start, durationMin, resourceId: chosenResource, allowOutsideHours: pick?.kind === 'custom' && outsideHours },
        { onSuccess: () => router.back() },
      );
      return;
    }

    const cf = customFields();
    if (typeof cf === 'string') return setFormError(cf);
    const body: BookingCreateInput = {
      serviceId,
      resourceId: chosenResource,
      startAt: start,
      durationMin,
      customer: { name: name.trim(), phone: normalizeMyPhone(phone) },
      locationAddress: address.trim() || null,
      customFields: cf,
      customerNotes: notes.trim() || null,
      internalNotes: internalNotes.trim() || null,
      source: walkIn ? 'walk_in' : 'app',
      allowOutsideHours: pick?.kind === 'custom' && outsideHours,
    };
    const check = bookingCreateSchema.safeParse(body);
    if (!check.success) return setFormError(check.error.issues[0]?.message ?? t.common.genericError);
    setFormError(null);
    create.mutate(body, { onSuccess: (b) => router.replace({ pathname: '/calendar/[id]', params: { id: String(b.id) } }) });
  };

  const mutation = editing ? move : create;
  const label = business.resourceLabel;

  return (
    <StackScreen
      title={editing ? s.rescheduleTitle : s.newTitle}
      subtitle={existing ? `${existing.customer.name} · ${existing.service.name}` : undefined}
      footer={
        <Button title={editing ? s.reschedule : s.create} loading={mutation.isPending} disabled={!pick} onPress={submit} />
      }
    >
      <FormError message={formError ?? (mutation.error ? errorMessage(mutation.error) : null)} />

      <Card className="gap-3 p-3.5">
        {!editing ? (
          <ChipGroup label={s.service}>
            {allServices.map((x) => (
              <Chip key={x.id} role="radio" label={x.name} selected={x.id === serviceId} onPress={() => selectService(x)} />
            ))}
          </ChipGroup>
        ) : null}

        {durations.length > 1 ? (
          <ChipGroup label={s.duration}>
            {durations.map((d) => (
              <Chip
                key={d}
                role="radio"
                label={formatDuration(d)}
                selected={d === durationMin}
                onPress={() => {
                  setDurationMin(d);
                  resetPick();
                }}
              />
            ))}
          </ChipGroup>
        ) : null}

        {offered.length ? (
          <ChipGroup label={s.resource(label)}>
            <Chip role="radio" label={s.any} selected={resourceId === null} onPress={() => selectResource(null)} />
            {offered.map((r) => (
              <Chip key={r.id} role="radio" label={r.name} selected={resourceId === r.id} onPress={() => selectResource(r.id)} />
            ))}
          </ChipGroup>
        ) : (
          <Text className="text-[14px] text-muted">{s.noResourcesForService(label)}</Text>
        )}
      </Card>

      {offered.length ? (
        <Card className="gap-3 p-3.5">
          <View className="gap-1.5">
            <Text className="text-[13px] font-bold text-label">{s.date}</Text>
            <DateSelect
              label={s.date}
              value={date}
              onChange={(d) => {
                setDate(d);
                resetPick();
              }}
            />
          </View>

          <View className="gap-2">
            <Text className="text-[13px] font-bold text-label">{s.time}</Text>
            {availability.isLoading ? (
              <LoadingState />
            ) : availability.error ? (
              <FormError message={errorMessage(availability.error)} />
            ) : slots.length === 0 ? (
              <Text className="text-[14px] text-muted">{s.noSlots}</Text>
            ) : (
              <View className="flex-row flex-wrap gap-2">
                {slots.map((x) => (
                  <Chip
                    key={x.startAt}
                    role="radio"
                    label={formatTime(formatInTimeZone(new Date(x.startAt), tz, 'HH:mm'))}
                    selected={pick?.kind === 'slot' && pick.slot.startAt === x.startAt}
                    onPress={() => setPick({ kind: 'slot', slot: x })}
                  />
                ))}
              </View>
            )}
          </View>

          <SwitchRow
            label={s.otherTime}
            hint={s.otherTimeHint}
            value={pick?.kind === 'custom'}
            onChange={(on) => setPick(on ? { kind: 'custom' } : null)}
          />
          {pick?.kind === 'custom' ? (
            <>
              <TimeSelect label={s.time} value={customTime} onChange={setCustomTime} step={5} />
              <SwitchRow label={s.outsideHours} hint={s.outsideHoursHint} value={outsideHours} onChange={setOutsideHours} />
            </>
          ) : null}
        </Card>
      ) : null}

      {!editing ? (
        <>
          <Card className="gap-3 p-3.5">
            <SectionLabel label={s.customer} />
            <TextField compact label={s.customerName} value={name} onChangeText={setName} maxLength={100} autoCapitalize="words" />
            <TextField
              compact
              label={s.customerPhone}
              value={phone}
              onChangeText={setPhone}
              onBlur={() => setPhone(normalizeMyPhone(phone))}
              keyboardType="phone-pad"
              placeholder="012-345 6789"
            />
            {service?.locationType === 'at_customer_location' ? (
              <TextField compact label={s.address} hint={s.addressHint} value={address} onChangeText={setAddress} maxLength={500} multiline />
            ) : null}
            <SwitchRow label={s.walkIn} value={walkIn} onChange={setWalkIn} />
          </Card>

          {serviceFields.length ? (
            <Card className="gap-3 p-3.5">
              <SectionLabel label={s.details} />
              {serviceFields.map((f) => (
                <FieldInput key={f.id} field={f} value={answers[f.fieldKey] ?? ''} onChange={(v) => setAnswers((a) => ({ ...a, [f.fieldKey]: v }))} />
              ))}
            </Card>
          ) : null}

          <Card className="gap-3 p-3.5">
            <TextField compact label={s.notes} value={notes} onChangeText={setNotes} maxLength={1000} multiline />
            <TextField compact label={s.internalNotes} hint={s.internalNotesHint} value={internalNotes} onChangeText={setInternalNotes} maxLength={1000} multiline />
          </Card>
        </>
      ) : null}
    </StackScreen>
  );
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="text-[13px] font-bold text-label">{label}</Text>
      <View className="flex-row flex-wrap gap-2">{children}</View>
    </View>
  );
}

/** One booking question (custom field). Required marks are shown but not enforced for owner bookings. */
function FieldInput({ field, value, onChange }: { field: BookingField; value: string; onChange: (v: string) => void }) {
  const label = field.isRequired ? `${field.label} *` : field.label;
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
