/**
 * Work that must not delay the response (push notifications). Errors are logged, never thrown.
 * Tests call `settleBackground()` to wait for it.
 */
const pending = new Set<Promise<unknown>>();

export function runInBackground(label: string, task: () => Promise<unknown>): void {
  const p = task()
    .catch((err: unknown) => console.error(`[background] ${label} failed:`, err))
    .finally(() => pending.delete(p));
  pending.add(p);
}

export async function settleBackground(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}
