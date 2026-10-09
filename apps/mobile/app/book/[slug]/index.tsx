import { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { addDays, format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import {
  normalizeMyPhone,
  publicBookingCreateSchema,
  type AvailableSlot,
  type NextAvailableSlot,
  type PublicBookingCreateInput,
  type PublicBusiness,
  type PublicService,
} from '@outletbooking/shared';
import { Brand } from '@/components/Brand';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { ChipGroup, FieldInput, fieldAnswers } from '@/features/bookings/components/FieldInput';
import { formatTimeSpan, todayIn, whatsappUrl } from '@/features/bookings/format';
import { Progress, PublicPage, SummaryRow } from '@/features/public/components/PublicPage';
import {
  useCreatePublicBooking,
  usePublicBusiness,
  usePublicNextAvailable,
  usePublicQuote,
  usePublicSlots,
} from '@/features/public/hooks';
import { ApiError } from '@/lib/api';
import { formatDuration, formatRM } from '@/lib/format';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const b = t.book;
const STEPS = 4; // service → time → details → confirmed

/**
 * Public booking page (FR-08, wireframes C1–C3), opened from the owner's link or QR code — no login.
 * Service → duration / resource / date / slot → booking questions + name and phone → confirmation page.
 */
export default function BookingPage() {
  const { slug = '' } = useLocalSearchParams<{ slug: string }>();
  const { data: biz, isPending, error, refetch } = usePublicBusiness(slug);

  if (isPending) return <LoadingState label={b.loading} />;
  if (error) {
    const notFound = error instanceof ApiError && [400, 404].includes(error.status);
    if (!notFound) return <ErrorState error={error} onRetry={() => void refetch()} />;
    return (
      <PublicPage>
        <Brand />
        <Card className="p-5">
          <Text className="text-[15px]">{b.notFound}</Text>
        </Card>
      </PublicPage>
    );
  }
  return (
    <>
      <Head>
        <title>{b.pageTitle(biz.name)}</title>
      </Head>
      <BookingFlow biz={biz} />
    </>
  );
}

type Step = 1 | 2 | 3;

function BookingFlow({ biz }: { biz: PublicBusiness }) {
  const tz = biz.timezone;
  const [step, setStep] = useState<Step>(1);
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [durationMin, setDurationMin] = useState(0);
  const [resourceId, setResourceId] = useState<number | null>(null);
  const [date, setDate] = useState(() => todayIn(tz));
  const [slot, setSlot] = useState<AvailableSlot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const service = biz.services.find((s) => s.id === serviceId) ?? null;

  const chooseService = (svc: PublicService) => {
    if (svc.id !== serviceId) {
      setServiceId(svc.id);
      setDurationMin(svc.durationOptions?.length ? svc.durationOptions[0]! : svc.durationMin);
      setResourceId(null);
      setSlot(null);
    }
  };

  if (step === 1 || !service) {
    return <ServiceStep biz={biz} selected={serviceId} onSelect={chooseService} onNext={() => service && setStep(2)} />;
  }
  if (step === 2 || !slot) {
    return (
      <TimeStep
        biz={biz}
        service={service}
        durationMin={durationMin}
        setDurationMin={(d) => {
          setDurationMin(d);
          setSlot(null);
        }}
        resourceId={resourceId}
        setResourceId={(id) => {
          setResourceId(id);
          setSlot(null);
        }}
        date={date}
        setDate={(d) => {
          setDate(d);
          setSlot(null);
        }}
        slot={slot}
        setSlot={(s) => {
          setSlot(s);
          setNotice(null);
        }}
        pickCell={(id, s) => {
          // C2 grid: choose court and time together (no slot reset).
          setResourceId(id);
          setSlot(s);
          setNotice(null);
        }}
        pickNext={(n) => {
          // F2 "Next available": jump to that day and time.
          setDate(formatInTimeZone(new Date(n.startAt), tz, 'yyyy-MM-dd'));
          setSlot({ startAt: n.startAt, endAt: n.endAt, resourceIds: [n.resourceId] });
          setNotice(null);
        }}
        notice={notice}
        onBack={() => setStep(1)}
        onNext={() => slot && setStep(3)}
      />
    );
  }
  return (
    <DetailsStep
      biz={biz}
      service={service}
      durationMin={durationMin}
      resourceId={resourceId}
      slot={slot}
      onBack={() => setStep(2)}
      onSlotTaken={() => {
        setSlot(null);
        setNotice(b.slotTaken);
        setStep(2);
      }}
    />
  );
}

// ─── Step 1: service (C1) ──────────────────────────────────────────────────────

function ServiceStep({
  biz,
  selected,
  onSelect,
  onNext,
}: {
  biz: PublicBusiness;
  selected: number | null;
  onSelect: (s: PublicService) => void;
  onNext: () => void;
}) {
  const bookable = biz.services.filter((s) => biz.resources.some((r) => r.serviceIds.includes(s.id)));
  return (
    <PublicPage
      footer={
        biz.bookingEnabled && bookable.length ? (
          <>
            <Button title={t.common.continue} disabled={selected === null} onPress={onNext} />
            <Text className="text-center text-[12px] text-muted">{b.poweredBy}</Text>
          </>
        ) : undefined
      }
    >
      <BusinessHeader biz={biz} />

      {!biz.bookingEnabled ? (
        <Card className="gap-3 p-4">
          <Text className="text-[14px]">{b.paused}</Text>
          <ContactButtons biz={biz} />
        </Card>
      ) : bookable.length === 0 ? (
        <Card>
          <EmptyState title={b.noServices} />
          <View className="px-4 pb-4">
            <ContactButtons biz={biz} />
          </View>
        </Card>
      ) : (
        <>
          <View className="gap-1.5">
            <View className="flex-row justify-between">
              <Text className="text-[12px] font-semibold text-muted">{b.step(1, STEPS)}</Text>
              <Text className="text-[12px] font-semibold text-muted">{b.chooseService}</Text>
            </View>
            <Progress current={1} total={STEPS} />
          </View>
          <Text className="text-[22px] font-extrabold">{b.whatToBook}</Text>
          {bookable.map((svc) => (
            <ServiceCard key={svc.id} svc={svc} selected={svc.id === selected} onPress={() => onSelect(svc)} />
          ))}
        </>
      )}
    </PublicPage>
  );
}

function BusinessHeader({ biz }: { biz: PublicBusiness }) {
  const initials = biz.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-3">
        <View className="h-12 w-12 items-center justify-center rounded-button bg-primary">
          <Text className="text-[17px] font-extrabold text-white">{initials}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-[20px] font-extrabold">{biz.name}</Text>
          {biz.description ? (
            <Text className="text-[13px] text-muted" numberOfLines={2}>
              {biz.description}
            </Text>
          ) : null}
        </View>
      </View>
      {biz.address ? (
        <View className="flex-row items-center gap-1.5">
          <Icon name="pin" size={16} color={colors.muted} />
          <Text className="flex-1 text-[13px] text-muted">{biz.address}</Text>
        </View>
      ) : null}
    </View>
  );
}

function ContactButtons({ biz }: { biz: PublicBusiness }) {
  return (
    <View className="gap-2">
      {biz.whatsappPhone ? <Button title={b.whatsapp} onPress={() => void Linking.openURL(whatsappUrl(biz.whatsappPhone!))} /> : null}
      {biz.phone && biz.phone !== biz.whatsappPhone ? (
        <Button variant={biz.whatsappPhone ? 'secondary' : 'primary'} title={b.call} onPress={() => void Linking.openURL(`tel:${biz.phone}`)} />
      ) : null}
    </View>
  );
}

function priceLabel(svc: PublicService): string {
  if (!svc.priceSen) return b.free;
  return `${formatRM(svc.priceSen)}${svc.priceUnit === 'per_block' ? t.setup.services.perBlockShort : ''}`;
}

function ServiceCard({ svc, selected, onPress }: { svc: PublicService; selected: boolean; onPress: () => void }) {
  const durations = svc.durationOptions?.length
    ? svc.durationOptions.length > 1
      ? `${formatDuration(svc.durationOptions[0]!)} – ${formatDuration(svc.durationOptions[svc.durationOptions.length - 1]!)}`
      : formatDuration(svc.durationOptions[0]!)
    : formatDuration(svc.durationMin);
  const extras = [
    svc.prepayFull && svc.priceSen ? b.fullPayment : null,
    svc.depositSen && !svc.prepayFull ? b.deposit(formatRM(svc.depositSen)) : null,
    svc.locationType === 'at_customer_location' ? b.atYourPlace : null,
  ].filter(Boolean);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      className={`flex-row items-center gap-3 rounded-card p-4 ${selected ? 'border-2 border-primary bg-soft' : 'border border-border bg-card active:bg-pressed'}`}
    >
      <View className="flex-1 gap-0.5">
        <Text className="text-[16px] font-bold">{svc.name}</Text>
        <Text className="text-[13px] text-muted">{[durations, priceLabel(svc), ...extras].join(' · ')}</Text>
        {svc.description ? <Text className="text-[13px] text-muted">{svc.description}</Text> : null}
      </View>
      <View className={`h-6 w-6 items-center justify-center rounded-full ${selected ? 'bg-primary' : 'border border-input-border'}`}>
        {selected ? <Icon name="check" size={16} color="#FFFFFF" /> : null}
      </View>
    </Pressable>
  );
}

// ─── Step 2: duration, resource, date, time (C2 / C6) ───────────────────────────

function TimeStep({
  biz,
  service,
  durationMin,
  setDurationMin,
  resourceId,
  setResourceId,
  date,
  setDate,
  slot,
  setSlot,
  pickCell,
  pickNext,
  notice,
  onBack,
  onNext,
}: {
  biz: PublicBusiness;
  service: PublicService;
  durationMin: number;
  setDurationMin: (d: number) => void;
  resourceId: number | null;
  setResourceId: (id: number | null) => void;
  date: string;
  setDate: (d: string) => void;
  slot: AvailableSlot | null;
  setSlot: (s: AvailableSlot) => void;
  pickCell: (resourceId: number, s: AvailableSlot) => void;
  pickNext: (n: NextAvailableSlot) => void;
  notice: string | null;
  onBack: () => void;
  onNext: () => void;
}) {
  const tz = biz.timezone;
  const offered = biz.resources.filter((r) => r.serviceIds.includes(service.id));
  const durations = service.durationOptions?.length ? service.durationOptions : [service.durationMin];
  const days = useMemo(() => {
    const first = parseISO(todayIn(tz));
    return Array.from({ length: biz.maxDaysAhead + 1 }, (_, i) => format(addDays(first, i), 'yyyy-MM-dd'));
  }, [tz, biz.maxDaysAhead]);
  // C2: courts are picked in a court × time grid (always queried as "any" so every court shows).
  const grid = offered.length > 1 && offered.every((r) => r.resourceType === 'court');
  const query = { serviceId: service.id, date, durationMin, resourceId: grid ? undefined : (resourceId ?? undefined) };
  const slots = usePublicSlots(biz.slug, query);
  const fullyBooked = !!slots.data && slots.data.slots.length === 0;
  const next = usePublicNextAvailable(biz.slug, fullyBooked ? query : null);
  const resourceName = (id: number) => offered.find((r) => r.id === id)?.name ?? '';
  const shorter = durations.filter((d) => d < durationMin);

  return (
    <PublicPage
      title={service.name}
      subtitle={`${biz.name} · ${b.step(2, STEPS)}`}
      onBack={onBack}
      progress={{ current: 2, total: STEPS }}
      footer={
        <>
          {slot ? (
            <View>
              <Text className="text-[15px] font-bold">
                {[resourceId ? resourceName(resourceId) : null, format(parseISO(date), 'EEE d MMM')].filter(Boolean).join(' · ')}
              </Text>
              <Text className="text-[13px] text-muted">
                {formatTimeSpan(slot.startAt, slot.endAt, tz)} · {formatDuration(durationMin)}
              </Text>
            </View>
          ) : null}
          <Button title={t.common.continue} disabled={!slot} onPress={onNext} />
        </>
      }
    >
      <FormError message={notice} />

      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{format(parseISO(date), 'MMMM yyyy')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          {days.map((d) => {
            const on = d === date;
            const dt = parseISO(d);
            return (
              <Pressable
                key={d}
                onPress={() => setDate(d)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={format(dt, 'EEEE d MMMM')}
                className={`h-[60px] w-[50px] items-center justify-center rounded-button border ${on ? 'border-primary bg-primary' : 'border-input-border bg-card active:bg-pressed'}`}
              >
                <Text className={`text-[11px] font-semibold ${on ? 'text-white' : 'text-muted'}`}>{format(dt, 'EEE')}</Text>
                <Text className={`text-[17px] font-extrabold ${on ? 'text-white' : ''}`}>{format(dt, 'd')}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {durations.length > 1 ? (
        <ChipGroup label={b.howLong}>
          {durations.map((d) => (
            <Chip key={d} role="radio" label={formatDuration(d)} selected={d === durationMin} onPress={() => setDurationMin(d)} />
          ))}
        </ChipGroup>
      ) : null}

      {offered.length > 1 && !grid ? (
        <ChipGroup label={biz.resourceLabel}>
          <Chip role="radio" label={b.any} selected={resourceId === null} onPress={() => setResourceId(null)} />
          {offered.map((r) => (
            <Chip key={r.id} role="radio" label={r.name} selected={resourceId === r.id} onPress={() => setResourceId(r.id)} />
          ))}
        </ChipGroup>
      ) : null}

      <View className="gap-2">
        <Text className="text-[13px] font-bold text-label">{format(parseISO(date), 'EEEE, d MMM')}</Text>
        {slots.isPending ? (
          <LoadingState />
        ) : slots.error ? (
          <View className="gap-2">
            <FormError message={`${b.slotsError} ${errorMessage(slots.error)}`} />
            <Button variant="secondary" title={t.common.retry} onPress={() => void slots.refetch()} />
          </View>
        ) : fullyBooked ? (
          <FullyBooked
            biz={biz}
            date={date}
            durationMin={durationMin}
            shorter={shorter.length ? shorter[shorter.length - 1]! : null}
            onShorter={setDurationMin}
            next={next.data}
            loadingNext={next.isPending}
            onPickNext={pickNext}
          />
        ) : grid ? (
          <CourtGrid
            courts={offered}
            slots={slots.data.slots}
            tz={tz}
            selected={slot && resourceId !== null ? { resourceId, startAt: slot.startAt } : null}
            onPick={pickCell}
            hint={b.gridHint(formatDuration(durationMin))}
          />
        ) : (
          <View className="flex-row flex-wrap gap-2">
            {slots.data.slots.map((s) => (
              <Chip
                key={s.startAt}
                role="radio"
                label={formatInTimeZone(new Date(s.startAt), tz, 'h:mm a')}
                selected={slot?.startAt === s.startAt}
                onPress={() => setSlot(s)}
              />
            ))}
          </View>
        )}
      </View>
    </PublicPage>
  );
}

// ─── C2 court × time grid (sports) ──────────────────────────────────────────────

function CourtGrid({
  courts,
  slots,
  tz,
  selected,
  onPick,
  hint,
}: {
  courts: PublicBusiness['resources'];
  slots: AvailableSlot[];
  tz: string;
  selected: { resourceId: number; startAt: string } | null;
  onPick: (resourceId: number, s: AvailableSlot) => void;
  hint: string;
}) {
  return (
    <View className="gap-2">
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="gap-1.5">
          <View className="flex-row gap-1.5">
            <View className="w-[64px]" />
            {courts.map((c) => (
              <Text key={c.id} className="w-[76px] text-center text-[12px] font-bold text-label" numberOfLines={1}>
                {c.name}
              </Text>
            ))}
          </View>
          {slots.map((s) => {
            const time = formatInTimeZone(new Date(s.startAt), tz, 'h:mm a');
            return (
              <View key={s.startAt} className="flex-row items-center gap-1.5">
                <Text className="w-[64px] text-[12px] font-semibold text-muted">{time}</Text>
                {courts.map((c) => {
                  const free = s.resourceIds.includes(c.id);
                  const on = selected?.resourceId === c.id && selected.startAt === s.startAt;
                  return (
                    <Pressable
                      key={c.id}
                      disabled={!free}
                      onPress={() => onPick(c.id, s)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on, disabled: !free }}
                      accessibilityLabel={`${c.name} ${time} ${free ? '' : b.booked}`}
                      className={`h-11 w-[76px] items-center justify-center rounded-input border ${
                        on
                          ? 'border-primary bg-primary'
                          : free
                            ? 'border-input-border bg-card active:bg-pressed'
                            : 'border-border bg-neutral-bg'
                      }`}
                    >
                      {on ? (
                        <Icon name="check" size={18} color="#FFFFFF" />
                      ) : free ? null : (
                        <Text className="text-[11px] font-semibold text-neutral-fg">{b.booked}</Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </View>
      </ScrollView>
      <Text className="text-[12px] text-muted">{hint}</Text>
    </View>
  );
}

// ─── F2 fully booked ────────────────────────────────────────────────────────────

function FullyBooked({
  biz,
  date,
  durationMin,
  shorter,
  onShorter,
  next,
  loadingNext,
  onPickNext,
}: {
  biz: PublicBusiness;
  date: string;
  durationMin: number;
  shorter: number | null;
  onShorter: (d: number) => void;
  next: NextAvailableSlot[] | undefined;
  loadingNext: boolean;
  onPickNext: (n: NextAvailableSlot) => void;
}) {
  const tz = biz.timezone;
  return (
    <View className="gap-3">
      <Card className="gap-2 p-4">
        <Text className="text-[16px] font-extrabold">{b.fullyBooked(format(parseISO(date), 'EEE, d MMM'))}</Text>
        <Text className="text-[14px] text-muted">{b.fullyBookedBody(biz.resourceLabel, formatDuration(durationMin), shorter !== null)}</Text>
        {shorter !== null ? (
          <View className="flex-row">
            <Chip role="radio" label={formatDuration(shorter)} selected={false} onPress={() => onShorter(shorter)} />
          </View>
        ) : null}
      </Card>

      <Text className="text-[13px] font-bold text-label">
        {b.nextAvailable} · {formatDuration(durationMin)}
      </Text>
      {loadingNext ? (
        <LoadingState />
      ) : next && next.length ? (
        <Card className="overflow-hidden">
          {next.map((n, i) => (
            <Pressable
              key={`${n.startAt}-${n.resourceId}`}
              onPress={() => onPickNext(n)}
              accessibilityRole="button"
              className={`min-h-[56px] flex-row items-center gap-3 px-3.5 py-3 active:bg-pressed ${i ? 'border-t border-border' : ''}`}
            >
              <View className="flex-1">
                <Text className="text-[15px] font-bold">
                  {formatInTimeZone(new Date(n.startAt), tz, 'EEE, d MMM')} · {formatInTimeZone(new Date(n.startAt), tz, 'h:mm a')}
                </Text>
                <Text className="text-[13px] text-muted">{n.resourceName}</Text>
              </View>
              <Icon name="chevron-right" size={18} color={colors.muted} />
            </Pressable>
          ))}
        </Card>
      ) : (
        <Card className="p-4">
          <Text className="text-[14px] text-muted">{b.nothingSoon}</Text>
        </Card>
      )}

      {biz.whatsappPhone ? (
        <Button
          variant="secondary"
          title={b.askCancellations(biz.name)}
          onPress={() => void Linking.openURL(whatsappUrl(biz.whatsappPhone!))}
        />
      ) : null}
    </View>
  );
}

// ─── Step 3: details (C3 / C5) ───────────────────────────────────────────────────

function DetailsStep({
  biz,
  service,
  durationMin,
  resourceId,
  slot,
  onBack,
  onSlotTaken,
}: {
  biz: PublicBusiness;
  service: PublicService;
  durationMin: number;
  resourceId: number | null;
  slot: AvailableSlot;
  onBack: () => void;
  onSlotTaken: () => void;
}) {
  const tz = biz.timezone;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreatePublicBooking(biz.slug);
  const quote = usePublicQuote(biz.slug, { serviceId: service.id, startAt: slot.startAt, durationMin });

  const fields = biz.bookingFields.filter((f) => f.serviceId === null || f.serviceId === service.id);
  const atCustomer = service.locationType === 'at_customer_location';
  // "Any": the slot lists free resources least busy first; the API makes the same choice.
  const shownResource = biz.resources.find((r) => r.id === (resourceId ?? slot.resourceIds[0]))?.name;

  const submit = () => {
    const missing = fields.find((f) => f.isRequired && !answers[f.fieldKey]?.trim());
    if (atCustomer && !address.trim()) return setFormError(`${b.address}: ${t.common.required}`);
    if (missing) return setFormError(`${missing.label}: ${t.common.required}`);
    const cf = fieldAnswers(fields, answers);
    if (typeof cf === 'string') return setFormError(cf);
    const body: PublicBookingCreateInput = {
      serviceId: service.id,
      resourceId: resourceId ?? undefined,
      startAt: slot.startAt,
      durationMin,
      customer: { name: name.trim(), phone: normalizeMyPhone(phone) },
      locationAddress: atCustomer ? address.trim() : null,
      customFields: cf,
      customerNotes: notes.trim() || null,
    };
    const check = publicBookingCreateSchema.safeParse(body);
    if (!check.success) return setFormError(check.error.issues[0]?.message ?? t.common.genericError);
    setFormError(null);
    create.mutate(body, {
      onSuccess: (booking) => router.replace({ pathname: '/my-booking/[token]', params: { token: booking.token } }),
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'slot_taken') onSlotTaken();
      },
    });
  };

  const q = quote.data;
  const buttonTitle = q && q.amountDueSen > 0 ? `${b.bookNow} · ${formatRM(q.amountDueSen)}` : b.bookNow;

  return (
    <PublicPage
      title={b.yourDetails}
      subtitle={`${biz.name} · ${b.step(3, STEPS)}`}
      onBack={onBack}
      progress={{ current: 3, total: STEPS }}
      footer={<Button title={buttonTitle} loading={create.isPending} onPress={submit} />}
    >
      <Card className="gap-2 p-4">
        <Text className="text-[16px] font-extrabold">{[service.name, shownResource].filter(Boolean).join(' · ')}</Text>
        <SummaryRow
          label={formatInTimeZone(new Date(slot.startAt), tz, 'EEE, d MMM yyyy')}
          value={`${formatTimeSpan(slot.startAt, slot.endAt, tz)} · ${formatDuration(durationMin)}`}
        />
        {q && (q.lines.length > 1 || q.lines.some((l) => l.ruleName)) ? (
          q.lines.map((l) => (
            <SummaryRow
              key={l.startAt}
              label={`${formatInTimeZone(new Date(l.startAt), tz, 'h:mm a')} · ${formatDuration(l.durationMin)}${l.ruleName ? ` (${l.ruleName})` : ''}`}
              value={formatRM(l.priceSen)}
            />
          ))
        ) : null}
        {q ? <SummaryRow label={b.total} value={q.priceSen ? formatRM(q.priceSen) : b.free} strong /> : null}
      </Card>

      <FormError message={formError ?? (create.error && !(create.error instanceof ApiError && create.error.code === 'slot_taken') ? errorMessage(create.error) : null)} />

      <TextField label={b.fullName} value={name} onChangeText={setName} maxLength={100} autoCapitalize="words" autoComplete="name" />
      <TextField
        label={b.mobile}
        hint={b.mobileHint}
        prefix="+60 "
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
        placeholder="12-345 6789"
      />
      {atCustomer ? (
        <TextField label={b.address} hint={b.addressHint} value={address} onChangeText={setAddress} maxLength={500} multiline />
      ) : null}
      {fields.map((f) => (
        <FieldInput
          key={f.fieldKey}
          field={f}
          value={answers[f.fieldKey] ?? ''}
          onChange={(v) => setAnswers((a) => ({ ...a, [f.fieldKey]: v }))}
          optionalHint={b.optional}
        />
      ))}
      <TextField label={`${b.notes} ${b.optional}`} value={notes} onChangeText={setNotes} maxLength={1000} multiline />

      {q ? (
        <Card className="gap-1.5 bg-soft p-4">
          {q.amountDueSen > 0 ? (
            <>
              <SummaryRow label={b.payNow(q.paymentMode === 'deposit' ? 'deposit' : 'full')} value={formatRM(q.amountDueSen)} strong />
              {q.priceSen > q.amountDueSen ? <Text className="text-[13px] text-muted">{b.balanceLater(formatRM(q.priceSen - q.amountDueSen))}</Text> : null}
              <Text className="text-[13px] text-muted">{b.payNote}</Text>
            </>
          ) : q.priceSen > 0 ? (
            <SummaryRow label={b.payLater} value={formatRM(q.priceSen)} strong />
          ) : null}
          <Text className="text-[13px] text-muted">{b.cancelPolicy(formatDuration(biz.cancelCutoffMin))}</Text>
        </Card>
      ) : quote.isPending ? (
        <LoadingState />
      ) : null}
    </PublicPage>
  );
}
