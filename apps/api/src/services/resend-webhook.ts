import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { emailEvents, type Db } from '@outletbooking/db';
import type { EmailStatus } from '@outletbooking/shared';

/**
 * Resend → us (I27): delivery events for emails we sent. Resend signs webhooks with Svix: the signed text is
 * `${svix-id}.${svix-timestamp}.${body}`, the key is the base64 part of the `whsec_…` secret, and the header holds one or
 * more space-separated `v1,<base64 signature>` values. A timestamp more than 5 minutes off is refused (replay).
 */
const TOLERANCE_SECONDS = 5 * 60;

export function verifySvixSignature(
  secret: string,
  headers: { id: string | undefined; timestamp: string | undefined; signature: string | undefined },
  body: string,
  now: Date = new Date(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(now.getTime() / 1000 - sentAt) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(' ').some((part) => {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** What each Resend event type means for an email. Anything else (opened, clicked, delayed…) is ignored. */
const EVENT_STATUS: Record<string, EmailStatus> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
};

/** A bounce or spam report is final: a late "delivered" for the same message never hides it. */
const isProblem = (s: string) => s === 'bounced' || s === 'complained' || s === 'failed';

interface ResendEvent {
  type?: unknown;
  data?: { email_id?: unknown; bounce?: { message?: unknown; type?: unknown }; reason?: unknown };
}

/** Apply one verified event. Returns true when an email we know about was updated. Unknown ids are fine (not an error). */
export async function applyResendEvent(db: Db, event: ResendEvent): Promise<boolean> {
  const status = typeof event.type === 'string' ? EVENT_STATUS[event.type] : undefined;
  const id = event.data?.email_id;
  if (!status || typeof id !== 'string') return false;
  const [row] = await db
    .select({ status: emailEvents.status, details: emailEvents.details })
    .from(emailEvents)
    .where(eq(emailEvents.providerMessageId, id))
    .limit(1);
  if (!row) return false;
  if (isProblem(row.status) && !isProblem(status)) return false;
  const why = event.data?.bounce?.message ?? event.data?.reason;
  await db
    .update(emailEvents)
    .set({ status, details: { ...row.details, ...(typeof why === 'string' ? { reason: why.slice(0, 200) } : {}) } })
    .where(eq(emailEvents.providerMessageId, id));
  return true;
}
