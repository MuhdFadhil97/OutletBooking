import { and, asc, eq, sql } from 'drizzle-orm';
import { businessMembers, emailEvents, type Db } from '@outletbooking/db';
import type { Mailer } from './mailer';

/** "m***@gmail.com": enough to recognise it, not enough to mail it. The full address is never stored in `email_events`. */
export function maskEmail(address: string): string {
  const [local = '', domain = ''] = address.split('@');
  return `${local.slice(0, 1) || '*'}***@${domain}`;
}

/**
 * Wraps a mailer so every email that carries `meta` leaves a row in `email_events` (I27): who it went to (masked), which
 * template, which business, and Resend's id so the delivery webhook can find it. A failed send is recorded as `failed`
 * and still throws, exactly as before. Writing the row never changes whether an email is sent: if it fails it is only logged.
 */
export function trackMail(db: Db, inner: Mailer): Mailer {
  return {
    async send(message) {
      const { meta, ...rest } = message;
      let receipt: Awaited<ReturnType<Mailer['send']>>;
      try {
        receipt = await inner.send(rest);
      } catch (err) {
        if (meta) {
          await record(db, message.to, meta, 'failed', null, { error: (err instanceof Error ? err.message : 'send failed').slice(0, 200) });
        }
        throw err;
      }
      if (meta) await record(db, message.to, meta, 'sent', (receipt && receipt.providerId) || null, {});
      return receipt;
    },
  };
}

async function record(
  db: Db,
  to: string,
  meta: NonNullable<Parameters<Mailer['send']>[0]['meta']>,
  status: 'sent' | 'failed',
  providerId: string | null,
  details: Record<string, string>,
): Promise<void> {
  try {
    // Only the user is known (a sign-in or reset email): use their business, owner first, so a problem can be traced.
    let businessId = meta.businessId ?? null;
    if (businessId === null && meta.userId != null) {
      const [m] = await db
        .select({ businessId: businessMembers.businessId })
        .from(businessMembers)
        .where(and(eq(businessMembers.userId, meta.userId), eq(businessMembers.isActive, true)))
        .orderBy(sql`${businessMembers.role} = 'owner' desc`, asc(businessMembers.id))
        .limit(1);
      businessId = m?.businessId ?? null;
    }
    await db.insert(emailEvents).values({
      businessId,
      userId: meta.userId ?? null,
      template: meta.template,
      toMasked: maskEmail(to),
      providerMessageId: providerId,
      status,
      details,
    });
  } catch (err) {
    console.error('[mail] could not record the email event', err instanceof Error ? err.message : err);
  }
}
