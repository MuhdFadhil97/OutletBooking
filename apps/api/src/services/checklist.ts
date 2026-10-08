import { and, eq, exists, isNull, sql } from 'drizzle-orm';
import { bookings, businesses, resources, workingHours, type Db } from '@outletbooking/db';
import type { ChecklistUpdate, SetupChecklist, SetupStep } from '@outletbooking/shared';
import { notFound } from '../errors';
import { isOnlinePaymentAvailable } from './payments';

/** Keys in businesses.settings for what only the app knows (no schema change needed). */
const LINK_SHARED_KEY = 'checklistLinkSharedAt';
const HIDDEN_KEY = 'checklistHiddenAt';

/**
 * D8 · First-time Today checklist, worked out from real data:
 * account (always) · a bookable resource with hours · ToyyibPay connected ·
 * booking link shared · at least one booking.
 */
export async function getSetupChecklist(db: Db, businessId: number): Promise<SetupChecklist> {
  const [biz] = await db
    .select({ settings: businesses.settings })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), isNull(businesses.deletedAt)))
    .limit(1);
  if (!biz) throw notFound('Business');

  const [counts] = await db
    .select({
      resourceCount: sql<number>`count(*)::int`,
    })
    .from(resources)
    .where(
      and(
        eq(resources.businessId, businessId),
        eq(resources.isActive, true),
        isNull(resources.deletedAt),
        exists(
          db
            .select({ one: sql`1` })
            .from(workingHours)
            .where(and(eq(workingHours.businessId, businessId), eq(workingHours.resourceId, resources.id))),
        ),
      ),
    );
  const [anyBooking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.businessId, businessId))
    .limit(1);

  const resourceCount = counts?.resourceCount ?? 0;
  const done: Record<SetupStep, boolean> = {
    account: true,
    resources: resourceCount > 0,
    // H1: the business's own ToyyibPay account is connected.
    payments: await isOnlinePaymentAvailable(db, businessId),
    shareLink: typeof biz.settings[LINK_SHARED_KEY] === 'string',
    testBooking: !!anyBooking,
  };
  const steps = (Object.keys(done) as SetupStep[]).map((key) => ({ key, done: done[key] }));
  const doneCount = steps.filter((s) => s.done).length;

  return {
    steps,
    doneCount,
    total: steps.length,
    resourceCount,
    hidden: doneCount === steps.length || typeof biz.settings[HIDDEN_KEY] === 'string',
  };
}

/** Records "link shared" / "hide checklist" (first time wins), then returns the checklist. */
export async function updateSetupChecklist(db: Db, businessId: number, input: ChecklistUpdate): Promise<SetupChecklist> {
  const now = new Date().toISOString();
  const patch: Record<string, string> = {};
  if (input.linkShared) patch[LINK_SHARED_KEY] = now;
  if (input.hide) patch[HIDDEN_KEY] = now;
  await db
    .update(businesses)
    // Existing keys win, so the first time is kept.
    .set({ settings: sql`${JSON.stringify(patch)}::jsonb || ${businesses.settings}` })
    .where(and(eq(businesses.id, businessId), isNull(businesses.deletedAt)));
  return getSetupChecklist(db, businessId);
}
