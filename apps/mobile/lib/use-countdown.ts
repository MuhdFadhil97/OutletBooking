import { useEffect, useState } from 'react';

/** Seconds left until `iso` (ticks every second); null when there is no deadline. */
export function useCountdown(iso: string | null | undefined): number | null {
  const target = iso ? new Date(iso).getTime() : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (target === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  return target === null ? null : Math.max(0, Math.round((target - now) / 1000));
}

/** 372 → "06:12" */
export const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
