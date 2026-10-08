import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { formatInTimeZone } from 'date-fns-tz';
import { paymentAccountConnectSchema, type BusinessTemplate, type PaymentAccountView } from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { ListRow } from '@/components/ui/Rows';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import {
  useCheckPaymentTest,
  useConnectPaymentAccount,
  useDisconnectPaymentAccount,
  usePaymentAccount,
  useStartPaymentTest,
} from '@/features/payments/hooks';
import { useBusiness, useSetupSummary } from '@/features/setup/hooks';
import { paymentRuleLabel } from '@/features/setup/payment';
import { confirm } from '@/lib/confirm';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.payments;

/** H1 · Payments: connect the business's own ToyyibPay (secret key, auto category, RM 1 test), payment-to-confirm rule. */
export default function PaymentsScreen() {
  const account = usePaymentAccount();
  const business = useBusiness();
  if (account.isPending || business.isPending) return <LoadingState />;
  if (account.error || business.error) {
    return <ErrorState error={account.error ?? business.error} onRetry={() => void account.refetch()} />;
  }
  return <Payments acc={account.data} businessName={business.data.name} tz={business.data.timezone} />;
}

function Payments({ acc, businessName, tz }: { acc: PaymentAccountView; businessName: string; tz: string }) {
  const toast = useToast();
  const summary = useSetupSummary();
  const disconnect = useDisconnectPaymentAccount();
  const connected = acc.status === 'connected';

  const onDisconnect = async () => {
    if (await confirm(s.disconnectTitle, s.disconnectBody, s.disconnect)) {
      disconnect.mutate(undefined, { onSuccess: () => toast(s.disconnected) });
    }
  };

  const rule = summary.data?.paymentRule;
  const template = summary.data?.template as BusinessTemplate | undefined;

  return (
    <StackScreen title={s.title} subtitle={s.subtitle}>
      <FormError message={disconnect.error ? errorMessage(disconnect.error) : null} />
      {connected ? <Connected acc={acc} tz={tz} /> : null}

      <View className="flex-row gap-2.5 rounded-input bg-soft px-3.5 py-3">
        <Icon name="check" size={18} color={colors.primary} />
        <Text className="flex-1 text-[13px] text-label">{s.moneyFlow}</Text>
      </View>

      {connected ? null : <ConnectSteps businessName={businessName} />}

      <Card className="overflow-hidden">
        <ListRow
          title={s.confirmRule}
          subtitle={rule && rule !== 'mixed' && template ? paymentRuleLabel(rule, template) : s.ruleHint}
          onPress={() => router.push('/setup/payment-rule')}
          last
        />
      </Card>
      <Text className="text-[12px] text-muted">{s.feeNote}</Text>

      {connected ? (
        <Pressable onPress={() => void onDisconnect()} accessibilityRole="button" className="min-h-[44px] items-center justify-center">
          <Text className="text-[14px] font-bold text-danger">{s.disconnect}</Text>
        </Pressable>
      ) : null}
    </StackScreen>
  );
}

function Connected({ acc, tz }: { acc: PaymentAccountView; tz: string }) {
  const toast = useToast();
  const start = useStartPaymentTest();
  const check = useCheckPaymentTest();
  const [started, setStarted] = useState(false);
  const [waiting, setWaiting] = useState(false);

  const runTest = () =>
    start.mutate(undefined, {
      onSuccess: (test) => {
        setStarted(true);
        setWaiting(false);
        void Linking.openURL(test.url);
      },
    });
  const checkTest = () =>
    check.mutate(undefined, {
      onSuccess: (a) => {
        if (a.testedAt) toast(s.testOk);
        else setWaiting(true);
      },
    });

  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-ok-bg">
          <Icon name="check" color={colors['ok-fg']} />
        </View>
        <View className="flex-1">
          <Text className="text-[16px] font-extrabold">{s.connected}</Text>
          {acc.secretKeyLast4 ? <Text className="text-[13px] text-muted">{s.keyEnding(acc.secretKeyLast4)}</Text> : null}
        </View>
      </View>
      <Text className={`text-[13px] ${acc.testedAt ? 'font-semibold text-ok-fg' : 'text-muted'}`}>
        {acc.testedAt ? s.testPassed(formatInTimeZone(acc.testedAt, tz, 'd MMM, h:mm a')) : s.testNotYet}
      </Text>
      <FormError message={start.error ? errorMessage(start.error) : check.error ? errorMessage(check.error) : null} />
      {acc.testedAt ? null : (
        <>
          <Button title={s.runTest} variant={started ? 'secondary' : 'primary'} loading={start.isPending} onPress={runTest} />
          {started ? (
            <>
              <Button title={s.checkTest} loading={check.isPending} onPress={checkTest} />
              {waiting ? <Text className="text-[13px] text-pend-fg">{s.testStillWaiting}</Text> : null}
            </>
          ) : (
            <Text className="text-[12px] text-muted">{s.runTestHint}</Text>
          )}
        </>
      )}
    </Card>
  );
}

function ConnectSteps({ businessName }: { businessName: string }) {
  const toast = useToast();
  const connect = useConnectPaymentAccount();
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | undefined>();

  const onConnect = () => {
    const parsed = paymentAccountConnectSchema.safeParse({ secretKey: key });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    connect.mutate(parsed.data.secretKey, {
      onSuccess: () => {
        setKey('');
        toast(s.connectedToast);
      },
    });
  };

  return (
    <Card className="gap-4 p-4">
      <Text className="text-[16px] font-extrabold">{s.stepsTitle}</Text>
      <Step n={1} title={s.step1} sub={s.step1Sub}>
        <Pressable onPress={() => void Linking.openURL('https://toyyibpay.com')} accessibilityRole="link" className="min-h-[44px] justify-center">
          <Text className="text-[14px] font-bold text-primary">{s.openToyyibPay}</Text>
        </Pressable>
      </Step>
      <Step n={2} title={s.step2} sub={s.step2Help}>
        <TextField
          compact
          label={s.secretKey}
          value={key}
          onChangeText={setKey}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          error={error}
        />
      </Step>
      <Step n={3} title={s.step3} sub={s.step3Sub(businessName)} />
      <FormError message={connect.error ? errorMessage(connect.error) : null} />
      <Button title={s.connect} loading={connect.isPending} disabled={!key.trim()} onPress={onConnect} />
    </Card>
  );
}

function Step({ n, title, sub, children }: { n: number; title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <View className="flex-row gap-3">
      <View className="h-7 w-7 items-center justify-center rounded-full bg-primary-tint">
        <Text className="text-[13px] font-extrabold text-primary">{n}</Text>
      </View>
      <View className="flex-1 gap-1">
        <Text className="text-[15px] font-bold">{title}</Text>
        {sub ? <Text className="text-[13px] text-muted">{sub}</Text> : null}
        {children}
      </View>
    </View>
  );
}
