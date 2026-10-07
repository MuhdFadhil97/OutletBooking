import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { TEMPLATE_INFO, type BusinessTemplate, type PaymentRule } from '@outletbooking/shared';
import { StackScreen } from '@/components/StackScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState, FormError, LoadingState, errorMessage } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { useSetPaymentRule, useSetupSummary } from '@/features/setup/hooks';
import { paymentRuleHint, paymentRuleLabel } from '@/features/setup/payment';
import { closeWith } from '@/lib/close-with';
import { t } from '@/strings/en';

const s = t.setup.paymentRule;

/** Setup → Payment to confirm: one rule for every service (choices come from the template config). */
export default function PaymentRuleScreen() {
  const summary = useSetupSummary();
  const save = useSetPaymentRule();
  const [rule, setRule] = useState<PaymentRule | null>(null);

  useEffect(() => {
    if (summary.data && rule === null && summary.data.paymentRule && summary.data.paymentRule !== 'mixed') {
      setRule(summary.data.paymentRule);
    }
  }, [summary.data, rule]);

  if (summary.isPending) return <LoadingState />;
  if (summary.error) return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;

  const template = summary.data.template as BusinessTemplate;
  const choices = TEMPLATE_INFO[template].paymentRules;
  // The current rule is always offered, even if this type does not list it.
  const current = summary.data.paymentRule;
  const options = current && current !== 'mixed' && !choices.includes(current) ? [...choices, current] : choices;

  return (
    <StackScreen
      title={s.title}
      footer={
        <Button
          title={s.save}
          loading={save.isPending}
          disabled={!rule || rule === current}
          onPress={() => rule && save.mutate(rule, { onSuccess: closeWith(t.common.saved) })}
        />
      }
    >
      <FormError message={save.error ? errorMessage(save.error) : null} />
      <Text className="text-[14px] text-muted">{s.intro}</Text>
      {current === 'mixed' ? (
        <View className="rounded-input bg-pend-bg px-3.5 py-3">
          <Text className="text-[13px] font-semibold text-pend-fg">{s.mixedNote}</Text>
        </View>
      ) : null}
      <Text className="text-[13px] font-bold text-label">{s.question}</Text>
      <Card className="overflow-hidden">
        {options.map((o, i) => {
          const selected = rule === o;
          return (
            <Pressable
              key={o}
              onPress={() => setRule(o)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              className={`min-h-[56px] flex-row items-center gap-3 px-3.5 py-3 active:bg-pressed ${i < options.length - 1 ? 'border-b border-border' : ''}`}
            >
              <View className={`h-5 w-5 items-center justify-center rounded-full border-2 ${selected ? 'border-primary' : 'border-input-border'}`}>
                {selected ? <View className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="text-[15px] font-bold">{paymentRuleLabel(o, template)}</Text>
                <Text className="text-[12px] text-muted">{paymentRuleHint(o, template)}</Text>
              </View>
            </Pressable>
          );
        })}
      </Card>
    </StackScreen>
  );
}
