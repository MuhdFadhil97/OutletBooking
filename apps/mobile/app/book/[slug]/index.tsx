import { useState } from 'react';
import { Linking, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  normalizeMyPhone,
  phoneE164,
  type PublicBookingCreateInput,
  type PublicBusiness,
  type PublicService,
} from '@outletbooking/shared';
import { Brand } from '@/components/Brand';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { todayIn } from '@/features/bookings/format';
import { DetailsStep, type DetailsValue } from '@/features/public/components/DetailsStep';
import { PageShell } from '@/features/public/components/PageShell';
import { ServiceStep } from '@/features/public/components/ServiceStep';
import { TimeStep, type TimeChoice } from '@/features/public/components/TimeStep';
import { slotTime, whenLine } from '@/features/public/format';
import { useCreatePublicBooking, usePublicBusiness } from '@/features/public/hooks';
import { ApiError } from '@/lib/api';
import { formatDuration, formatRM } from '@/lib/format';
import { t } from '@/strings/en';

const b = t.book;
const STEPS = 3;

/**
 * Public booking page (no login), opened from the shared link or QR. One screen per business
 * type, driven by the template: C1 service → C2 court grid / F1 date & time (F2 when full) →
 * C3 / C5 / C6b details → the booking's own page (confirmation, view / cancel).
 */
export default function BookingPage() {
  const { slug = '' } = useLocalSearchParams<{ slug: string }>();
  const biz = usePublicBusiness(slug);

  if (biz.isPending) return <LoadingState label={b.loading} />;
  if (biz.error) {
    const notFound = biz.error instanceof ApiError && [400, 404].includes(biz.error.status);
    if (!notFound) return <ErrorState error={biz.error} onRetry={() => void biz.refetch()} />;
    return (
      <View className="flex-1 justify-center gap-5 bg-bg px-5">
        <Brand />
        <Card className="p-5">
          <Text className="text-[15px]">{b.notFound}</Text>
        </Card>
      </View>
    );
  }
  if (!biz.data.bookingEnabled) return <Paused biz={biz.data} />;
  return <Flow slug={slug} biz={biz.data} />;
}

function Flow({ slug, biz }: { slug: string; biz: PublicBusiness }) {
  const today = todayIn(biz.timezone);
  const create = useCreatePublicBooking(slug);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [service, setService] = useState<PublicService | null>(biz.services.length === 1 ? biz.services[0]! : null);
  const [date, setDate] = useState(today);
  const [durationMin, setDurationMin] = useState(service?.durationMin ?? 60);
  const [resourceId, setResourceId] = useState<number | undefined>(undefined);
  const [choice, setChoice] = useState<TimeChoice | null>(null);
  const [details, setDetails] = useState<DetailsValue>({ name: '', phone: '', address: '', notes: '', answers: {}, agreed: false });
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});

  if (!biz.services.length) {
    return (
      <PageShell biz={biz}>
        <Card>
          <EmptyState title={b.noServices} />
        </Card>
      </PageShell>
    );
  }

  const fields = service ? biz.bookingFields.filter((f) => f.serviceId === null || f.serviceId === service.id) : [];
  const resourceName = choice ? biz.resources.find((r) => r.id === (choice.resourceId ?? choice.slot.resourceIds[0]))?.name : undefined;

  const pickService = (svc: PublicService) => {
    setService(svc);
    setDurationMin(svc.durationOptions?.length ? Math.min(...svc.durationOptions) : svc.durationMin);
    setChoice(null);
    setResourceId(undefined);
  };

  const submit = () => {
    if (!service || !choice) return;
    const e: Partial<Record<string, string>> = {};
    if (!details.name.trim()) e.name = b.nameError;
    const phone = normalizeMyPhone(details.phone);
    if (!phoneE164.safeParse(phone).success) e.phone = b.phoneError;
    if (service.locationType === 'at_customer_location' && !details.address.trim()) e.address = b.addressError;
    for (const f of fields) {
      if (f.isRequired && !(details.answers[f.fieldKey] ?? '').trim()) e[f.fieldKey] = b.answerError(f.label);
    }
    if (!details.agreed) e.agreed = b.mustAgree;
    setErrors(e);
    if (Object.keys(e).length) return;

    const customFields: Record<string, string | number> = {};
    for (const f of fields) {
      const v = (details.answers[f.fieldKey] ?? '').trim();
      if (!v) continue;
      customFields[f.fieldKey] = f.fieldType === 'number' && !Number.isNaN(Number(v)) ? Number(v) : v;
    }
    const body: PublicBookingCreateInput = {
      serviceId: service.id,
      startAt: choice.slot.startAt,
      durationMin,
      ...(choice.resourceId ? { resourceId: choice.resourceId } : {}),
      customer: { name: details.name.trim(), phone },
      ...(service.locationType === 'at_customer_location' ? { locationAddress: details.address.trim() } : {}),
      customFields,
      customerNotes: details.notes.trim() || null,
    };
    create.mutate(body, {
      onSuccess: (res) => router.replace({ pathname: '/book/[slug]/b/[token]', params: { slug, token: res.token, new: '1' } }),
    });
  };

  const slotTaken = create.error instanceof ApiError && create.error.code === 'slot_taken';
  const summary =
    service && choice ? (
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1">
          <Text className="text-[14px] font-bold" numberOfLines={1}>
            {[service.name, resourceName].filter(Boolean).join(' · ')}
          </Text>
          <Text className="text-[13px] text-muted" numberOfLines={1}>
            {`${whenLine(choice.slot.startAt, choice.slot.endAt, biz.timezone)} · ${formatDuration(durationMin)}`}
          </Text>
        </View>
        <Text className="text-[16px] font-extrabold">{choice.slot.priceSen ? formatRM(choice.slot.priceSen) : b.free}</Text>
      </View>
    ) : null;

  if (step === 1 || !service) {
    return (
      <PageShell
        biz={biz}
        step={b.step(1, STEPS)}
        title={b.chooseService}
        footer={<Button title={b.continue} disabled={!service} onPress={() => setStep(2)} />}
      >
        <ServiceStep biz={biz} selected={service?.id ?? null} onSelect={pickService} />
      </PageShell>
    );
  }

  if (step === 2) {
    return (
      <PageShell
        biz={biz}
        compactHeader
        step={`${b.step(2, STEPS)} · ${service.name}`}
        title={b.chooseTime}
        footer={
          <View className="gap-2">
            {summary}
            <View className="flex-row gap-2">
              <View className="w-[96px]">
                <Button variant="secondary" title={b.back} onPress={() => setStep(1)} />
              </View>
              <View className="flex-1">
                <Button title={b.continue} disabled={!choice} onPress={() => setStep(3)} />
              </View>
            </View>
          </View>
        }
      >
        <TimeStep
          slug={slug}
          biz={biz}
          service={service}
          today={today}
          date={date}
          onDate={(d) => {
            setDate(d);
            setChoice(null);
          }}
          durationMin={durationMin}
          onDuration={(m) => {
            setDurationMin(m);
            setChoice(null);
          }}
          resourceId={resourceId}
          onResource={(id) => {
            setResourceId(id);
            setChoice(null);
          }}
          choice={choice}
          onChoice={setChoice}
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      biz={biz}
      compactHeader
      step={b.step(3, STEPS)}
      title={b.yourDetails}
      footer={
        <View className="flex-row gap-2">
          <View className="w-[96px]">
            <Button variant="secondary" title={b.back} onPress={() => setStep(2)} />
          </View>
          <View className="flex-1">
            <Button
              title={choice && choice.slot.priceSen === 0 ? b.bookFree : b.book}
              loading={create.isPending}
              onPress={submit}
            />
          </View>
        </View>
      }
    >
      {summary ? <Card className="p-4">{summary}</Card> : null}
      {slotTaken ? (
        <Card className="gap-2 border border-danger bg-danger-tint p-3.5">
          <Text className="text-[15px] font-extrabold text-danger">{t.booking.slotTaken}</Text>
          <Text className="text-[13px]">
            {choice ? t.booking.slotTakenBody(resourceName ?? biz.resourceLabel, slotTime(choice.slot.startAt, biz.timezone)) : t.booking.slotTakenGeneric}
          </Text>
          <Button
            variant="secondary"
            title={t.booking.pickAnother}
            onPress={() => {
              create.reset();
              setChoice(null);
              setStep(2);
            }}
          />
        </Card>
      ) : (
        <FormError message={create.error ? errorMessage(create.error) : null} />
      )}
      {choice ? (
        <DetailsStep
          biz={biz}
          service={service}
          fields={fields}
          priceSen={choice.slot.priceSen}
          value={details}
          onChange={(patch) => setDetails((d) => ({ ...d, ...patch }))}
          errors={errors}
        />
      ) : null}
    </PageShell>
  );
}

/** F3 · booking page paused by the owner (or the trial ended). */
function Paused({ biz }: { biz: PublicBusiness }) {
  const wa = biz.whatsappPhone ?? biz.phone;
  return (
    <PageShell biz={biz}>
      <Card className="gap-3 p-5">
        <Text className="text-[18px] font-extrabold">{b.closedTitle}</Text>
        <Text className="text-[14px] text-muted">{b.closedBody(biz.name)}</Text>
        {wa ? <Button title={b.whatsapp} onPress={() => void Linking.openURL(`https://wa.me/${wa.replace(/\D/g, '')}`)} /> : null}
        {biz.phone ? <Button variant="secondary" title={b.call} onPress={() => void Linking.openURL(`tel:${biz.phone}`)} /> : null}
      </Card>
      <Text className="text-center text-[13px] text-muted">{b.alreadyBooked}</Text>
    </PageShell>
  );
}
