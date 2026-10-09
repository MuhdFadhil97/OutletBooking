import { Pressable, View } from 'react-native';
import type { SetupChecklist, SetupStep } from '@outletbooking/shared';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Tag } from '@/components/ui/Tag';
import { Text } from '@/components/ui/Text';
import { t } from '@/strings/en';
import { colors } from '@/theme';

const s = t.today.checklist;

/** D8 · "Get ready for your first booking": 5 steps, each opens the screen that completes it. */
export function SetupChecklistCard({
  checklist,
  resourceLabel,
  onPressStep,
  onHide,
}: {
  checklist: SetupChecklist;
  resourceLabel: string;
  /** Not called for done steps or steps that are not available yet (payments until Phase 5). */
  onPressStep: (step: SetupStep) => void;
  onHide: () => void;
}) {
  const text: Record<SetupStep, { title: string; sub?: string }> = {
    account: { title: s.account },
    resources: { title: s.resources(resourceLabel), sub: s.resourcesSub(checklist.resourceCount, resourceLabel) },
    payments: { title: s.payments, sub: s.paymentsSub },
    shareLink: { title: s.shareLink, sub: s.shareLinkSub },
    testBooking: { title: s.testBooking, sub: s.testBookingSub },
  };

  return (
    <Card className="overflow-hidden">
      <View className="flex-row items-center gap-2 border-b border-border px-3.5 py-3">
        <View className="flex-1 gap-0.5">
          <Text className="text-[16px] font-extrabold">{s.title}</Text>
          <Text className="text-[12px] font-semibold text-muted">{s.progress(checklist.doneCount, checklist.total)}</Text>
        </View>
        <Pressable onPress={onHide} accessibilityRole="button" className="min-h-[44px] justify-center px-1">
          <Text className="text-[14px] font-bold text-primary">{s.hide}</Text>
        </Pressable>
      </View>
      <View className="h-1.5 bg-soft">
        <View className="h-1.5 bg-primary" style={{ width: `${(checklist.doneCount / checklist.total) * 100}%` }} />
      </View>
      {checklist.steps.map(({ key, done }, i) => {
        const pressable = !done;
        return (
          <Pressable
            key={key}
            onPress={pressable ? () => onPressStep(key) : undefined}
            disabled={!pressable}
            accessibilityRole={pressable ? 'button' : undefined}
            accessibilityState={{ checked: done }}
            className={`min-h-[56px] flex-row items-center gap-3 px-3.5 py-3 active:bg-pressed ${i ? 'border-t border-border' : ''}`}
          >
            <View
              className={`h-7 w-7 items-center justify-center rounded-full ${done ? 'bg-primary' : 'border-2 border-input-border'}`}
            >
              {done ? <Icon name="check" size={16} color="#FFFFFF" /> : null}
            </View>
            <View className="flex-1 gap-0.5">
              <Text className={`text-[15px] font-bold ${done ? 'text-muted line-through' : ''}`}>{text[key].title}</Text>
              {text[key].sub && !done ? <Text className="text-[13px] text-muted">{text[key].sub}</Text> : null}
            </View>
            {done ? <Tag label={s.done} tone="ok" /> : null}
            {pressable ? <Icon name="chevron-right" size={18} color={colors.muted} /> : null}
          </Pressable>
        );
      })}
    </Card>
  );
}
