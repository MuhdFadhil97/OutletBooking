import { useEffect, useState } from 'react';

/** Milliseconds left until `until` (ISO), ticking every second; 0 once passed, null without a deadline. */
export function useCountdown(until: string | null): number | null {
  const target = until ? Date.parse(until) : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (target === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  return target === null ? null : Math.max(0, target - now);
}

/** 372000 → "06:12" */
export function formatMmSs(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
