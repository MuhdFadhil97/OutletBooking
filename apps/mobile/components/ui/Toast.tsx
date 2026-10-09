import { useEffect, useSyncExternalStore } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '@/strings/en';
import { Text } from './Text';

/** D9 confirmation toast, optionally with an Undo action. Call `showToast()` from anywhere. */
export interface ToastOptions {
  message: string;
  /** e.g. Undo. The toast closes after the action runs. */
  action?: { label?: string; onPress: () => void };
  durationMs?: number;
}

let current: (ToastOptions & { id: number }) | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showToast(options: ToastOptions) {
  current = { ...options, id: ++seq };
  emit();
}

export function hideToast() {
  current = null;
  emit();
}

/** Rendered once in the root layout, above the tab bar. */
export function ToastHost() {
  const toast = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => null,
  );
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(hideToast, toast.durationMs ?? (toast.action ? 6000 : 3500));
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;
  return (
    <View
      pointerEvents="box-none"
      className="absolute left-4 right-4 items-center"
      style={{ bottom: insets.bottom + 76 }}
      accessibilityLiveRegion="polite"
    >
      <View className="w-full max-w-[480px] flex-row items-center gap-3 rounded-button bg-text px-4 py-3" accessibilityRole="alert">
        <Text className="flex-1 text-[14px] font-semibold text-white">{toast.message}</Text>
        {toast.action ? (
          <Pressable
            onPress={() => {
              toast.action!.onPress();
              hideToast();
            }}
            accessibilityRole="button"
            hitSlop={10}
            className="min-h-[36px] justify-center"
          >
            <Text className="text-[14px] font-extrabold text-primary-tint">{toast.action.label ?? t.toast.undo}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
