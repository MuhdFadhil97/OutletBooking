import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { ApiError } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { t } from '@/strings/en';
import { colors } from '@/theme';
import { Button } from './Button';
import { Text } from './Text';

export function LoadingState({ label = t.common.loading }: { label?: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-bg p-6" accessibilityLabel={label}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text className="text-muted">{label}</Text>
    </View>
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code !== 'network_error') return error.message;
    // In development, show which API address failed (wrong LAN IP, hotspot changed, API not running).
    return __DEV__ ? `${t.common.networkError} (${API_URL})` : t.common.networkError;
  }
  return t.common.genericError;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-bg p-6">
      <Text className="text-center text-[15px] text-muted">{errorMessage(error)}</Text>
      {onRetry ? <Button variant="secondary" title={t.common.retry} onPress={onRetry} className="w-48" /> : null}
    </View>
  );
}

export function EmptyState({ title, body, icon, action }: { title: string; body?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <View className="items-center gap-2 px-6 py-8">
      {icon}
      <Text className="text-center text-[16px] font-bold">{title}</Text>
      {body ? <Text className="text-center text-[14px] text-muted">{body}</Text> : null}
      {action}
    </View>
  );
}

/** D9 "That slot was just taken": someone booked the same time a moment ago. */
export function SlotTaken({ onPickAnother }: { onPickAnother: () => void }) {
  return (
    <View className="gap-2 rounded-input bg-danger-tint px-3.5 py-3" accessibilityRole="alert">
      <Text className="text-[15px] font-extrabold text-danger">{t.booking.slotTakenTitle}</Text>
      <Text className="text-[14px] text-danger">{t.booking.slotTakenBody}</Text>
      <Button variant="secondary" title={t.booking.otherTime} onPress={onPickAnother} />
    </View>
  );
}

/** Inline error banner for forms */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <View className="rounded-input bg-danger-tint px-3.5 py-3" accessibilityRole="alert">
      <Text className="text-[14px] text-danger">{message}</Text>
    </View>
  );
}
