import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { queryClient } from '@/lib/query-client';
import { useIsOnline, useLastSync } from '@/lib/network';
import { t } from '@/strings/en';
import { Text } from './Text';

type ToastAction = { label: string; onPress: () => void };
type ToastState = { id: number; message: string; action?: ToastAction } | null;

const ToastContext = createContext<(message: string, action?: ToastAction) => void>(() => undefined);

/** D9 · confirmation toast, e.g. "Checked in" or "Payment link sent · Undo". */
export const useToast = () => useContext(ToastContext);

let globalShow: ((message: string, action?: ToastAction) => void) | null = null;

/** Same as useToast(), for callbacks outside components (e.g. a mutation's onSuccess). */
export const showToast = (message: string, action?: ToastAction) => globalShow?.(message, action);

const BOTTOM_OFFSET = 72; // clear of the tab bar

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const online = useIsOnline();

  const show = useCallback((message: string, action?: ToastAction) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), message, action });
    timer.current = setTimeout(() => setToast(null), action ? 6000 : 3500);
  }, []);
  useEffect(() => {
    globalShow = show;
    return () => {
      globalShow = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [show]);
  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <View pointerEvents="box-none" className="absolute left-0 right-0 gap-2 px-4" style={{ bottom: insets.bottom + BOTTOM_OFFSET }}>
        {toast ? (
          <View accessibilityLiveRegion="polite" className="flex-row items-center gap-3 rounded-card bg-text px-4 py-3">
            <Text className="flex-1 text-[14px] font-semibold text-white">{toast.message}</Text>
            {toast.action ? (
              <Pressable
                onPress={() => {
                  toast.action!.onPress();
                  setToast(null);
                }}
                accessibilityRole="button"
                className="min-h-[44px] justify-center px-1"
              >
                <Text className="text-[14px] font-extrabold text-primary-tint">{toast.action.label}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {online ? null : <OfflineBar />}
      </View>
    </ToastContext.Provider>
  );
}

/** D9 · "You're offline · showing schedule from 5:41 PM" with Retry. */
function OfflineBar() {
  const last = useLastSync();
  return (
    <View accessibilityLiveRegion="polite" className="gap-1 rounded-card bg-pend-bg px-4 py-3">
      <View className="flex-row items-center gap-3">
        <Text className="flex-1 text-[14px] font-bold text-pend-fg">
          {last ? t.common.offlineSince(format(last, 'h:mm a')) : t.common.offline}
        </Text>
        <Pressable
          onPress={() => void queryClient.refetchQueries({ type: 'active' })}
          accessibilityRole="button"
          className="min-h-[44px] justify-center px-1"
        >
          <Text className="text-[14px] font-extrabold text-pend-fg">{t.common.retry}</Text>
        </Pressable>
      </View>
      <Text className="text-[12px] text-pend-fg">{t.common.offlineNote}</Text>
    </View>
  );
}
