import { useState, type ReactNode } from 'react';
import { Linking, View } from 'react-native';
import { router } from 'expo-router';
import { formatInTimeZone } from 'date-fns-tz';
import { connectToyyibPaySchema, type PaymentAccountInfo } from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { ListRow } from '@/components/ui/Rows';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { showToast } from '@/components/ui/Toast';
import { useMe } from '@/features/me/hooks';
import {
  useCheckTestPayment,
  useConnectToyyibPay,
  useDisconnectToyyibPay,
  usePaymentAccount,
  useStartTestPayment,
} from '@/features/payments/hooks';
import { confirm } from '@/lib/confirm';
import { openPaymentPage } from '@/lib/open-payment';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.payments;
const TZ = 'Asia/Kuala_Lumpur';

/** H1 · Payments: connect the business's own ToyyibPay (key → category → RM 1.00 test), payment rule link. */
export default function PaymentsScreen() {
  const { me } = useMe();
  const account = usePaymentAccount();

  if (account.isPending) return <LoadingState />;
  if (account.error) return <ErrorState error={account.error} onRetry={() => void account.refetch()} />;

  const info = account.data;
  return (
    <StackScreen title={s.title} subtitle={s.subtitle}>
      {info.status === 'connected' ? <Connected info={info} /> : <ConnectSteps businessName={me?.business.name ?? ''} />}

      <Text className="text-[13px] font-bold text-label">{s.rule}</Text>
      <Card className="overflow-hidden">
        <ListRow title={s.ruleLink} onPress={() => router.push('/setup/payment-rule')} last />
      </Card>

      <Text className="text-[12px] text-muted">{s.fees}</Text>
      {info.status === 'connected' ? <DisconnectButton /> : null}
    </StackScreen>
  );
}

function Connected({ info }: { info: PaymentAccountInfo }) {
  const startTest = useStartTestPayment();
  const checkTest = useCheckTestPayment();
  const [checked, setChecked] = useState(false);

  const runTest = () => startTest.mutate(undefined, { onSuccess: (l) => openPaymentPage(l.paymentUrl) });
  const check = () =>
    checkTest.mutate(undefined, {
      onSuccess: (a) => {
        setChecked(true);
        if (a.testedAt) showToast({ message: s.testPassed(formatInTimeZone(new Date(a.testedAt), TZ, 'd MMM, h:mm a')) });
      },
    });

  return (
    <>
      <Card className="gap-3 p-4">
        <View className="flex-row items-center gap-3">
          <View className="h-10 w-10 items-center justify-center rounded-full bg-ok-bg">
            <Icon name="check" color={colors['ok-fg']} />
          </View>
          <View className="flex-1">
            <Text className="text-[16px] font-extrabold">{s.connected}</Text>
            {info.secretKeyLast4 ? <Text className="text-[13px] text-muted">{s.keyEnding(info.secretKeyLast4)}</Text> : null}
          </View>
        </View>
        <Text className="text-[13px] text-muted">
          {info.testedAt
            ? s.testPassed(formatInTimeZone(new Date(info.testedAt), TZ, 'd MMM, h:mm a'))
            : info.testPending
              ? s.testWaiting
              : s.testNeeded}
        </Text>
        <FormError message={startTest.error ? errorMessage(startTest.error) : checkTest.error ? errorMessage(checkTest.error) : null} />
        {checked && info.testPending ? <Text className="text-[13px] text-pend-fg">{s.testNotYet}</Text> : null}
        {!info.testedAt ? (
          <View className="gap-2">
            <Button title={s.runTest} variant={info.testPending ? 'secondary' : 'primary'} loading={startTest.isPending} onPress={runTest} />
            {info.testPending ? <Button title={s.checkTest} loading={checkTest.isPending} onPress={check} /> : null}
          </View>
        ) : null}
      </Card>
      <Text className="text-[13px] text-muted">{s.moneyFlow}</Text>
    </>
  );
}

function ConnectSteps({ businessName }: { businessName: string }) {
  const connect = useConnectToyyibPay();
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const parsed = connectToyyibPaySchema.safeParse({ secretKey: key });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? s.keyLabel);
    setError(null);
    connect.mutate(parsed.data.secretKey, { onSuccess: () => showToast({ message: s.connected }) });
  };

  return (
    <>
      <Text className="text-[14px] text-muted">{s.moneyFlow}</Text>
      <Text className="text-[13px] font-bold text-label">{s.steps}</Text>
      <Card className="gap-4 p-4">
        <Step n={1} title={s.step1} sub={s.step1Sub}>
          <Button variant="secondary" title={s.openToyyibPay} onPress={() => void Linking.openURL('https://toyyibpay.com')} />
        </Step>
        <Step n={2} title={s.step2} sub={s.step2Help}>
          <TextField
            compact
            label={s.keyLabel}
            placeholder={s.keyHint}
            value={key}
            onChangeText={setKey}
            error={error ?? undefined}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </Step>
        <Step n={3} title={s.step3} sub={s.step3Sub(businessName)} />
        <FormError message={connect.error ? errorMessage(connect.error) : null} />
        <Button title={s.connect} loading={connect.isPending} onPress={submit} />
      </Card>
    </>
  );
}

function Step({ n, title, sub, children }: { n: number; title: string; sub: string; children?: ReactNode }) {
  return (
    <View className="flex-row gap-3">
      <View className="h-7 w-7 items-center justify-center rounded-full bg-primary-tint">
        <Text className="text-[13px] font-extrabold text-primary">{n}</Text>
      </View>
      <View className="flex-1 gap-2">
        <View className="gap-0.5">
          <Text className="text-[15px] font-bold">{title}</Text>
          <Text className="text-[13px] text-muted">{sub}</Text>
        </View>
        {children}
      </View>
    </View>
  );
}

function DisconnectButton() {
  const disconnect = useDisconnectToyyibPay();
  const onPress = async () => {
    if (await confirm(s.disconnectTitle, s.disconnectBody, s.disconnect)) disconnect.mutate();
  };
  return (
    <>
      <FormError message={disconnect.error ? errorMessage(disconnect.error) : null} />
      <Button variant="secondary" title={s.disconnect} loading={disconnect.isPending} onPress={() => void onPress()} />
    </>
  );
}
