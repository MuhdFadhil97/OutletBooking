import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { t } from '@/strings/en';
import { Icon } from './ui/Icon';
import { Text } from './ui/Text';

const s = t.legal;

/** O1a / G1 · "I agree to the Terms and Privacy Notice (PDPA)" — required before an account is created. */
export function ConsentCheckbox({ checked, onChange, error }: { checked: boolean; onChange: (v: boolean) => void; error?: string }) {
  return (
    <View className="gap-1">
      <View className="flex-row items-start gap-2.5">
        <Pressable
          onPress={() => onChange(!checked)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel={s.agreeLabel}
          hitSlop={12}
          className="min-h-[44px] justify-center"
        >
          <View
            className={`h-5 w-5 items-center justify-center rounded-[5px] border ${
              checked ? 'border-primary bg-primary' : error ? 'border-danger bg-card' : 'border-input-border bg-card'
            }`}
          >
            {checked ? <Icon name="check" size={14} color="#FFFFFF" /> : null}
          </View>
        </Pressable>
        <Text className="flex-1 py-3 text-[14px]">
          {s.agreePrefix}
          <Text className="text-[14px] font-bold text-primary" onPress={() => router.push('/terms')} accessibilityRole="link">
            {s.terms}
          </Text>
          {s.and}
          <Text className="text-[14px] font-bold text-primary" onPress={() => router.push('/privacy')} accessibilityRole="link">
            {s.privacy}
          </Text>
          .
        </Text>
      </View>
      {error ? <Text className="text-[12px] font-bold text-danger">{error}</Text> : null}
    </View>
  );
}
