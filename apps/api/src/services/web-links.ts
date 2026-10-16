/**
 * The app's "Choose a plan" opens the website already signed in. Better Auth makes the one-time link the same
 * way as for the emailed sign-in, but calls `sendMagicLink` to deliver it. For a handoff we pass a `handoffId`
 * in the link's metadata, and `sendMagicLink` parks the link here instead of emailing it.
 */
const parked = new Map<string, { url: string; at: number }>();
const KEEP_MS = 60_000;

export function parkHandoffLink(handoffId: string, url: string): void {
  const now = Date.now();
  for (const [id, link] of parked) if (now - link.at > KEEP_MS) parked.delete(id);
  parked.set(handoffId, { url, at: now });
}

/** The parked link, once. */
export function takeHandoffLink(handoffId: string): string | null {
  const link = parked.get(handoffId);
  parked.delete(handoffId);
  return link?.url ?? null;
}
