import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { adminAuditLog, plans, platformSettings, subscriptions, businesses, type Db, type Tx } from '@outletbooking/db';
import {
  DEFAULT_PLAN_SETTINGS,
  DEFAULT_PLANS,
  PAID_PLANS,
  PLAN_FEATURES,
  type AdminPlanCatalog,
  type PaidPlan,
  type PlanCatalogEntry,
  type PlanFeatures,
  type PlanSettings,
  type PublicPlans,
  type UpdatePlansInput,
} from '@outletbooking/shared';
import { AppError } from '../errors';

/**
 * I12 · Plans & prices. The `plans` and `platform_settings` tables hold what the website (I3, I4), the
 * app (E3), sign-up (trial length) and the admin plan actions (resource limits) use. Missing rows fall back
 * to the built-in defaults, so a fresh database still works.
 *
 * New prices apply to new payments and the next renewal: a business keeps `subscriptions.resource_limit`
 * until a plan is assigned or paid again.
 */

type Q = Db | Tx;

const isPaidPlan = (code: string): code is PaidPlan => PAID_PLANS.some((p) => p === code);

function toFeatures(raw: Record<string, boolean>, fallback: PlanFeatures): PlanFeatures {
  return Object.fromEntries(PLAN_FEATURES.map((f) => [f, typeof raw[f] === 'boolean' ? raw[f] : fallback[f]])) as PlanFeatures;
}

/** Plans in display order (Starter, Business) and the platform settings. */
export async function getPlanCatalog(q: Q): Promise<{ plans: PlanCatalogEntry[]; settings: PlanSettings }> {
  const [rows, [settingsRow]] = await Promise.all([
    q.select().from(plans).orderBy(asc(plans.sortOrder), asc(plans.id)),
    q.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1),
  ]);
  const catalog = DEFAULT_PLANS.map((fallback): PlanCatalogEntry => {
    const row = rows.find((r) => r.code === fallback.code);
    if (!row) return fallback;
    return {
      code: fallback.code,
      name: row.name,
      priceSen: row.priceSen,
      resourceLimit: row.resourceLimit,
      extraResourceSen: row.extraResourceSen,
      features: toFeatures(row.features, fallback.features),
      isPublic: row.isPublic,
    };
  });
  const settings: PlanSettings = settingsRow
    ? {
        trialDays: settingsRow.trialDays,
        graceDays: settingsRow.graceDays,
        renewalReminderDays: [...settingsRow.renewalReminderDays].sort((a, b) => b - a),
      }
    : DEFAULT_PLAN_SETTINGS;
  return { plans: catalog, settings };
}

/** Grace days (I12): how long a paid plan keeps working after a missed renewal. One primary-key read. */
export async function getGraceDays(q: Q): Promise<number> {
  const [row] = await q.select({ graceDays: platformSettings.graceDays }).from(platformSettings).where(eq(platformSettings.id, 1)).limit(1);
  return row?.graceDays ?? DEFAULT_PLAN_SETTINGS.graceDays;
}

/** Resource limit of a plan, for subscriptions.resource_limit when a plan is assigned. */
export async function planResourceLimit(q: Q, code: string): Promise<number> {
  const { plans: catalog } = await getPlanCatalog(q);
  const plan = isPaidPlan(code) ? catalog.find((p) => p.code === code) : undefined;
  if (!plan) throw new AppError(400, 'unknown_plan', 'Unknown plan');
  return plan.resourceLimit;
}

/** GET /plans (no login): only plans shown on the website, and nothing else. */
export async function getPublicPlans(db: Db): Promise<PublicPlans> {
  const { plans: catalog, settings } = await getPlanCatalog(db);
  return { plans: catalog.filter((p) => p.isPublic), trialDays: settings.trialDays };
}

/** GET /admin/plans: the catalog plus how many businesses are on each plan. */
export async function getAdminPlanCatalog(db: Db): Promise<AdminPlanCatalog> {
  const [catalog, counts] = await Promise.all([
    getPlanCatalog(db),
    db
      .select({ plan: subscriptions.plan, n: sql<number>`count(*)::int` })
      .from(subscriptions)
      .innerJoin(businesses, and(eq(businesses.id, subscriptions.businessId), isNull(businesses.deletedAt)))
      .where(eq(subscriptions.status, 'active'))
      .groupBy(subscriptions.plan),
  ]);
  const businessesByPlan = Object.fromEntries(
    PAID_PLANS.map((code) => [code, counts.find((c) => c.plan === code)?.n ?? 0]),
  ) as Record<PaidPlan, number>;
  return { ...catalog, businessesByPlan };
}

const rm = (sen: number) => `RM ${(sen / 100).toLocaleString('en-MY', { minimumFractionDigits: sen % 100 ? 2 : 0 })}`;
const FEATURE_LABEL: Record<(typeof PLAN_FEATURES)[number], string> = {
  online_payment: 'online payment',
  staff_app: 'staff app',
  reports: 'reports',
};

/** "price RM 49 → RM 59; resources 3 → 5" (empty when nothing changed). Shown in the I9 audit log. */
function planChanges(before: PlanCatalogEntry, after: UpdatePlansInput['plans'][number]): string[] {
  const out: string[] = [];
  if (before.priceSen !== after.priceSen) out.push(`price ${rm(before.priceSen)} → ${rm(after.priceSen)}`);
  if (before.resourceLimit !== after.resourceLimit) out.push(`resources ${before.resourceLimit} → ${after.resourceLimit}`);
  if (before.extraResourceSen !== after.extraResourceSen) {
    out.push(`extra resource ${rm(before.extraResourceSen)} → ${rm(after.extraResourceSen)}`);
  }
  for (const f of PLAN_FEATURES) {
    if (before.features[f] !== after.features[f]) out.push(`${FEATURE_LABEL[f]} ${after.features[f] ? 'on' : 'off'}`);
  }
  if (before.isPublic !== after.isPublic) out.push(after.isPublic ? 'shown on website' : 'hidden from website');
  return out;
}

function settingsChanges(before: PlanSettings, after: UpdatePlansInput['settings']): string[] {
  const out: string[] = [];
  if (before.trialDays !== after.trialDays) out.push(`trial ${before.trialDays} → ${after.trialDays} days`);
  if (before.graceDays !== after.graceDays) out.push(`grace ${before.graceDays} → ${after.graceDays} days`);
  const was = before.renewalReminderDays.join(', ') || 'none';
  const now = after.renewalReminderDays.join(', ') || 'none';
  if (was !== now) out.push(`renewal reminders ${was} → ${now}`);
  return out;
}

/**
 * I12 save. Writes the plan rows and the single settings row, and one audit row per thing that changed
 * (`update_plans` per plan, `update_platform_settings`) in the same transaction (rule 17).
 * Existing subscriptions are NOT touched: they keep their limit until the next renewal or plan change.
 */
export async function updatePlanCatalog(db: Db, adminUserId: number, input: UpdatePlansInput): Promise<AdminPlanCatalog> {
  const reminders = [...new Set(input.settings.renewalReminderDays)].sort((a, b) => b - a);
  const settings = { ...input.settings, renewalReminderDays: reminders };

  await db.transaction(async (tx) => {
    // One super admin at a time: the before → after in the audit log must be what was really replaced.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('plan-catalog'))`);
    const before = await getPlanCatalog(tx);

    const planChangeRows = input.plans
      .map((after) => {
        const was = before.plans.find((p) => p.code === after.code)!;
        return { after, was, changes: planChanges(was, after) };
      })
      .filter((c) => c.changes.length > 0);
    const settingsDiff = settingsChanges(before.settings, settings);
    if (planChangeRows.length === 0 && settingsDiff.length === 0) {
      throw new AppError(409, 'no_change', 'Nothing was changed');
    }

    for (const { after, was, changes } of planChangeRows) {
      await tx
        .insert(plans)
        .values({
          code: after.code,
          name: was.name,
          priceSen: after.priceSen,
          resourceLimit: after.resourceLimit,
          extraResourceSen: after.extraResourceSen,
          features: after.features,
          isPublic: after.isPublic,
          sortOrder: DEFAULT_PLANS.findIndex((p) => p.code === after.code) + 1,
        })
        .onConflictDoUpdate({
          target: plans.code,
          set: {
            priceSen: after.priceSen,
            resourceLimit: after.resourceLimit,
            extraResourceSen: after.extraResourceSen,
            features: after.features,
            isPublic: after.isPublic,
          },
        });
      await tx.insert(adminAuditLog).values({
        adminUserId,
        businessId: null,
        action: 'update_plans',
        reason: input.reason,
        details: { plan: after.code, changes: changes.join('; ') },
      });
    }

    if (settingsDiff.length > 0) {
      await tx
        .insert(platformSettings)
        .values({ id: 1, trialDays: settings.trialDays, graceDays: settings.graceDays, renewalReminderDays: reminders })
        .onConflictDoUpdate({
          target: platformSettings.id,
          set: { trialDays: settings.trialDays, graceDays: settings.graceDays, renewalReminderDays: reminders },
        });
      await tx.insert(adminAuditLog).values({
        adminUserId,
        businessId: null,
        action: 'update_platform_settings',
        reason: input.reason,
        details: { changes: settingsDiff.join('; ') },
      });
    }
  });
  return getAdminPlanCatalog(db);
}
