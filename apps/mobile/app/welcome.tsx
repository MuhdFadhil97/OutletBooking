import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  TEMPLATE_INFO,
  WEEKDAY_SHORT,
  expandHours,
  groupWeeklyHours,
  type BusinessTemplate,
  type OnboardingSetupInput,
  type PaymentRule,
  type Service,
} from '@outletbooking/shared';
import { Brand } from '@/components/Brand';
import { RoleGate } from '@/components/RoleGate';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChipChoice } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { MoneyField } from '@/components/ui/MoneyField';
import { SwitchRow } from '@/components/ui/Rows';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { TimeSelect } from '@/components/ui/TimeSelect';
import { Avatar } from '@/features/account/components/Avatar';
import { clearOnboardingPending } from '@/features/auth/onboarding';
import { useMe } from '@/features/me/hooks';
import { useBookingFields, useFinishOnboarding, useServices } from '@/features/setup/hooks';
import { paymentRuleLabel } from '@/features/setup/payment';
import { formatDuration } from '@/lib/format';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.signup;
const DURATIONS = [15, 30, 45, 60, 90, 120] as const;
const TRAVEL = [0, 15, 30, 45] as const;
const MAX_RESOURCES = 10; // trial plan limit
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/** O1c · sign-up step 3 of 3 — one screen for every business type, driven by the template config. */
export default function WelcomeScreen() {
  return (
    <RoleGate role="owner" allowOnboarding>
      <SetupStep />
    </RoleGate>
  );
}

type Day = { open: boolean; startTime: string; endTime: string };
type Edit = { priceSen: number; durationMin: number };

function initialHours(template: BusinessTemplate): Record<number, Day> {
  const rows = expandHours(TEMPLATE_INFO[template].defaultHours);
  return Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((d) => {
      const r = rows.find((x) => x.weekday === d);
      return [d, r ? { open: true, startTime: r.startTime, endTime: r.endTime } : { open: false, startTime: '09:00', endTime: '18:00' }];
    }),
  );
}

function SetupStep() {
  const { me } = useMe();
  const services = useServices();
  const fields = useBookingFields();
  if (!me || !services.data || !fields.data) {
    const error = services.error ?? fields.error;
    return (
      <Frame title="">
        {error ? <ErrorState error={error} onRetry={() => void services.refetch()} /> : <LoadingState />}
      </Frame>
    );
  }
  return (
    <SetupForm
      template={me.business.template}
      ownerName={me.user.name}
      defaultLabel={me.business.resourceLabel}
      services={services.data}
      questions={fields.data.filter((f) => f.isActive).map((f) => f.label)}
    />
  );
}

function SetupForm({
  template,
  ownerName,
  defaultLabel,
  services,
  questions,
}: {
  template: BusinessTemplate;
  ownerName: string;
  defaultLabel: string;
  services: Service[];
  questions: string[];
}) {
  const info = TEMPLATE_INFO[template];
  const finish = useFinishOnboarding();
  const typeName = t.templates[template as keyof typeof t.templates]?.title ?? template;

  const [label, setLabel] = useState(defaultLabel);
  const [count, setCount] = useState(info.defaultResourceCount);
  const [people, setPeople] = useState<string[]>([ownerName]);
  const [hours, setHours] = useState(() => initialHours(template));
  const [editingHours, setEditingHours] = useState(false);
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [rule, setRule] = useState<PaymentRule>(info.defaultPaymentRule);
  const [travel, setTravel] = useState(() => Math.max(0, ...services.map((x) => x.travelBufferMin)));
  const mobile = services.find((x) => x.locationType === 'at_customer_location');
  const [mobileOn, setMobileOn] = useState(true);
  const [mobileFeeSen, setMobileFeeSen] = useState(5000);
  const [area, setArea] = useState('Klang Valley');
  const [customersPick, setCustomersPick] = useState(true);
  const [first, setFirst] = useState({ name: '', durationMin: 60, priceSen: 0 });
  const [error, setError] = useState<string | null>(null);

  const extras = new Set(info.setupExtras);
  const isPeople = info.resourceSetup === 'people';
  const isOther = !!info.resourceLabelChoices;
  const showMobile = extras.has('mobile_inspection') && !!mobile;
  const showTravel = extras.has('travel');
  const showQuestions = template === 'vehicle_inspection' || template === 'workshop';

  // Cleared only when the owner finishes or skips: until then every owner screen sends them back here.
  const done = () => {
    clearOnboardingPending();
    router.replace('/today');
  };

  const value = (svc: Service): Edit => edits[svc.id] ?? { priceSen: svc.priceSen, durationMin: svc.durationMin };
  const change = (svc: Service, patch: Partial<Edit>) => setEdits((e) => ({ ...e, [svc.id]: { ...value(svc), ...patch } }));

  const hoursLines = useMemo(
    () =>
      groupWeeklyHours(
        Object.entries(hours)
          .filter(([, d]) => d.open)
          .map(([weekday, d]) => ({ weekday: Number(weekday), startTime: d.startTime, endTime: d.endTime })),
      ),
    [hours],
  );

  const submit = () => {
    const names = isPeople ? people.map((p) => p.trim()) : Array.from({ length: count }, (_, i) => `${label} ${i + 1}`);
    if (names.some((n) => !n)) return setError(s.nameRequired);
    if (isOther && !first.name.trim()) return setError(s.firstServiceRequired);
    setError(null);

    const settings: NonNullable<OnboardingSetupInput['settings']> = {};
    if (showMobile) Object.assign(settings, { mobileFeeSen, serviceArea: area.trim() || null });
    if (template === 'barber_salon') settings.customersPickResource = customersPick;
    if (template === 'workshop') settings.pricesFrom = true;

    const body: OnboardingSetupInput = {
      ...(isOther ? { resourceLabel: label } : {}),
      resources: names.map((name, i) => ({ name, isMe: isPeople && i === 0 })),
      hours: WEEK.filter((d) => hours[d]!.open).map((weekday) => ({
        weekday,
        startTime: hours[weekday]!.startTime,
        endTime: hours[weekday]!.endTime,
      })),
      services: services
        .map((svc) => {
          const v = value(svc);
          return {
            id: svc.id,
            ...(v.priceSen !== svc.priceSen ? { priceSen: v.priceSen } : {}),
            ...(v.durationMin !== svc.durationMin ? { durationMin: v.durationMin } : {}),
            ...(svc.id === mobile?.id && showMobile && !mobileOn ? { isVisible: false } : {}),
          };
        })
        .filter((e) => Object.keys(e).length > 1),
      ...(isOther ? { newService: { name: first.name.trim(), durationMin: first.durationMin, priceSen: first.priceSen } } : {}),
      paymentRule: rule,
      ...(showTravel ? { travelBufferMin: travel } : {}),
      ...(Object.keys(settings).length ? { settings } : {}),
    };
    finish.mutate(body, { onSuccess: done });
  };

  return (
    <Frame
      title={s.setupTitle[template]}
      footer={
        <View className="gap-2">
          <Button title={s.finish} loading={finish.isPending} onPress={submit} />
          <Button title={s.skip} variant="secondary" disabled={finish.isPending} onPress={done} />
        </View>
      }
    >
      <Text className="text-[14px] text-muted">{s.setupBody(typeName)}</Text>
      <FormError message={error ?? (finish.error ? errorMessage(finish.error) : null)} />

      {isOther ? (
        <Section title={s.whatBook}>
          <ChipChoice options={info.resourceLabelChoices!} value={label} onChange={setLabel} format={(x) => x} />
        </Section>
      ) : null}

      {isPeople ? (
        <Section title={s.yourPeople(label)} action={{ label: s.addPerson(label), onPress: () => setPeople((p) => (p.length < MAX_RESOURCES ? [...p, ''] : p)) }}>
          <Card className="overflow-hidden">
            {people.map((name, i) => (
              <View key={i} className={`flex-row items-center gap-3 px-3.5 py-2.5 ${i < people.length - 1 ? 'border-b border-border' : ''}`}>
                <Avatar name={name || '?'} size={36} />
                {i === 0 ? (
                  <View className="flex-1">
                    <Text className="text-[15px] font-bold">{name}</Text>
                    <Text className="text-[12px] text-muted">{s.you(label)}</Text>
                  </View>
                ) : (
                  <>
                    <View className="flex-1">
                      <TextField
                        compact
                        label={s.personName(i + 1)}
                        value={name}
                        onChangeText={(v) => setPeople((p) => p.map((x, j) => (j === i ? v : x)))}
                        hint={s.inviteLater}
                        autoCapitalize="words"
                      />
                    </View>
                    <Pressable
                      onPress={() => setPeople((p) => p.filter((_, j) => j !== i))}
                      accessibilityRole="button"
                      accessibilityLabel={`${s.remove} ${name}`}
                      className="h-11 w-11 items-center justify-center"
                    >
                      <Icon name="x" size={18} color={colors.muted} />
                    </Pressable>
                  </>
                )}
              </View>
            ))}
          </Card>
        </Section>
      ) : (
        <Section title={s.howMany(label)}>
          <Card className="gap-3 p-3.5">
            <View className="flex-row items-center gap-3">
              <StepButton icon="minus" label={s.fewer} disabled={count <= 1} onPress={() => setCount((c) => Math.max(1, c - 1))} />
              <Text className="min-w-[40px] text-center text-[22px] font-extrabold">{count}</Text>
              <StepButton icon="plus" label={s.more} disabled={count >= MAX_RESOURCES} onPress={() => setCount((c) => Math.min(MAX_RESOURCES, c + 1))} />
            </View>
            <View className="flex-row flex-wrap gap-2">
              {Array.from({ length: count }, (_, i) => (
                <View key={i} className="rounded-full bg-soft px-3 py-1.5">
                  <Text className="text-[13px] font-semibold text-label">{`${label} ${i + 1}`}</Text>
                </View>
              ))}
            </View>
          </Card>
        </Section>
      )}

      {template === 'barber_salon' ? (
        <Card className="p-3.5">
          <SwitchRow label={s.customersPick(label)} hint={s.customersPickHint(label)} value={customersPick} onChange={setCustomersPick} />
        </Card>
      ) : null}

      {showMobile ? (
        <Section title={s.mobileTitle}>
          <Card className="gap-3 p-3.5">
            <SwitchRow label={s.mobileTitle} hint={s.mobileHint} value={mobileOn} onChange={setMobileOn} />
            {mobileOn ? (
              <>
                <MoneyField label={s.mobileFee} valueSen={mobileFeeSen} onChangeSen={setMobileFeeSen} />
                <TextField compact label={s.mobileArea} value={area} onChangeText={setArea} />
              </>
            ) : null}
          </Card>
        </Section>
      ) : null}

      {isOther ? (
        <Section title={s.firstService}>
          <Card className="gap-3 p-3.5">
            <TextField compact label={s.serviceName} value={first.name} onChangeText={(name) => setFirst((f) => ({ ...f, name }))} />
            <View className="gap-2">
              <Text className="text-[13px] font-bold text-label">{s.length}</Text>
              <ChipChoice options={DURATIONS} value={first.durationMin} onChange={(d) => setFirst((f) => ({ ...f, durationMin: d }))} format={formatDuration} />
            </View>
            <MoneyField label={s.priceLabel} valueSen={first.priceSen} onChangeSen={(priceSen) => setFirst((f) => ({ ...f, priceSen }))} />
          </Card>
        </Section>
      ) : services.length ? (
        <Section title={s.servicesHeading}>
          {services.map((svc) => {
            const v = value(svc);
            const options = svc.durationOptions?.length ? svc.durationOptions : null;
            const hiddenMobile = svc.id === mobile?.id && showMobile && !mobileOn;
            if (hiddenMobile) return null;
            return (
              <Card key={svc.id} className="gap-3 p-3.5">
                <Text className="text-[16px] font-extrabold">{svc.name}</Text>
                <View className="gap-2">
                  <Text className="text-[13px] font-bold text-label">{s.durationLabel}</Text>
                  {options ? (
                    <Text className="text-[14px] text-muted">{s.durationsFixed(options.map(formatDuration).join(' / '))}</Text>
                  ) : (
                    <ChipChoice options={DURATIONS} value={v.durationMin} onChange={(d) => change(svc, { durationMin: d })} format={formatDuration} />
                  )}
                </View>
                <MoneyField
                  label={svc.priceUnit === 'per_block' ? s.pricePerBlock(formatDuration(svc.durationMin)) : s.priceLabel}
                  valueSen={v.priceSen}
                  onChangeSen={(sen) => change(svc, { priceSen: sen })}
                />
              </Card>
            );
          })}
        </Section>
      ) : null}

      {showTravel ? (
        <Section title={s.travelTitle}>
          <ChipChoice options={TRAVEL} value={travel} onChange={setTravel} format={(m) => (m ? formatDuration(m) : s.none)} />
          <Text className="text-[12px] text-muted">{s.travelHint}</Text>
        </Section>
      ) : null}

      {showQuestions && questions.length ? (
        <Section title={s.askedFor}>
          <View className="flex-row flex-wrap gap-2">
            {questions.map((q) => (
              <View key={q} className="rounded-full bg-soft px-3 py-1.5">
                <Text className="text-[13px] font-semibold text-label">{q}</Text>
              </View>
            ))}
          </View>
          <Text className="text-[12px] text-muted">{template === 'workshop' ? s.pricesFromNote : s.askedForHint}</Text>
        </Section>
      ) : null}

      <Section title={s.openingHours} action={{ label: editingHours ? s.done : s.edit, onPress: () => setEditingHours((e) => !e) }}>
        <Card className="gap-2 p-3.5">
          {editingHours
            ? WEEK.map((d, i) => {
                const day = hours[d]!;
                const set = (patch: Partial<Day>) => setHours((h) => ({ ...h, [d]: { ...h[d]!, ...patch } }));
                return (
                  <View key={d} className={`gap-2 pb-2 ${i < WEEK.length - 1 ? 'border-b border-border' : ''}`}>
                    <SwitchRow label={WEEKDAY_SHORT[d]!} hint={day.open ? s.open : s.closed} value={day.open} onChange={(open) => set({ open })} />
                    {day.open ? (
                      <View className="flex-row gap-2">
                        <View className="flex-1">
                          <TimeSelect label={s.from} value={day.startTime} onChange={(startTime) => set({ startTime })} />
                        </View>
                        <View className="flex-1">
                          <TimeSelect label={s.to} value={day.endTime} min={day.startTime} allowMidnightEnd onChange={(endTime) => set({ endTime })} />
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })
            : hoursLines.map((g) => (
                <View key={g.days} className="flex-row justify-between">
                  <Text className="text-[14px] font-semibold">{g.days}</Text>
                  <Text className={`text-[14px] ${g.hours ? 'text-text' : 'text-muted'}`}>{g.hours ?? s.closed}</Text>
                </View>
              ))}
        </Card>
      </Section>

      <Section title={s.confirmQuestion}>
        <View className="flex-row rounded-input bg-pressed p-1">
          {info.paymentRules.map((r) => {
            const on = r === rule;
            return (
              <Pressable
                key={r}
                onPress={() => setRule(r)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                className={`h-[38px] flex-1 items-center justify-center rounded-[8px] px-1 ${on ? 'bg-card' : ''}`}
              >
                <Text className={`text-center text-[13px] font-bold ${on ? 'text-text' : 'text-muted'}`} numberOfLines={1}>
                  {paymentRuleLabel(r, template)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {rule === 'deposit' ? (
          <Text className="text-[12px] text-muted">{t.setup.paymentRule.hint[template === 'real_estate' ? 'fee' : 'deposit']}</Text>
        ) : null}
      </Section>
    </Frame>
  );
}

function StepButton({ icon, label, disabled, onPress }: { icon: 'plus' | 'minus'; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`h-11 w-11 items-center justify-center rounded-full border border-input-border bg-card ${disabled ? 'opacity-40' : 'active:bg-pressed'}`}
    >
      <Icon name={icon} size={20} color={colors.text} />
    </Pressable>
  );
}

function Section({ title, action, children }: { title: string; action?: { label: string; onPress: () => void }; children: ReactNode }) {
  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-[13px] font-bold text-label">{title}</Text>
        {action ? (
          <Pressable onPress={action.onPress} accessibilityRole="button" className="min-h-[44px] justify-center px-1">
            <Text className="text-[13px] font-bold text-primary">{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Frame({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="flex-grow gap-4 px-5 pb-6 pt-6" keyboardShouldPersistTaps="handled">
        <Brand step={{ current: 3, total: 3, label: s.step(3) }} />
        {title ? <Text className="text-[22px] font-extrabold">{title}</Text> : null}
        {children}
      </ScrollView>
      {footer ? <View className="border-t border-border bg-card px-5 pb-3 pt-3">{footer}</View> : null}
    </SafeAreaView>
  );
}
