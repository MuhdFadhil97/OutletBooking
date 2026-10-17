import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { businesses, emailEvents, type Db } from '@outletbooking/db';
import {
  countLight,
  EMAIL_PROBLEM_STATUSES,
  HEALTH_LOOKBACK_DAYS,
  type EmailProblemItem,
  type EmailProblemStatus,
  type HealthTile,
  type SystemHealth,
} from '@outletbooking/shared';
import type { Env } from '../env';
import type { JobMonitor } from './job-monitor';
import { countPaymentChecks, listPaymentChecks } from './payment-checks';

/**
 * I27 · System health: one call fills the whole page (refreshed every minute by the screen). Each tile is a light and, where
 * it means "things to look at", a count. Read-only; the actions (re-check a payment, retry a job) have their own routes.
 */
export interface HealthDeps {
  db: Db;
  env: Env;
  jobs: JobMonitor;
}

const DAY_MS = 86_400_000;
/** Slower than this and the API / database tile turns amber. */
const SLOW_MS = 1500;

const tile = (light: HealthTile['light'], over: Partial<HealthTile> = {}): HealthTile => ({ light, count: null, ms: null, note: null, ...over });

/** Emails that bounced, were marked as spam, or could not be sent, newest first. */
export async function listEmailProblems(db: Db, now: Date = new Date()): Promise<EmailProblemItem[]> {
  const since = new Date(now.getTime() - HEALTH_LOOKBACK_DAYS * DAY_MS);
  const rows = await db
    .select({
      id: emailEvents.id,
      at: emailEvents.updatedAt,
      template: emailEvents.template,
      toMasked: emailEvents.toMasked,
      status: emailEvents.status,
      details: emailEvents.details,
      businessId: businesses.id,
      businessName: businesses.name,
    })
    .from(emailEvents)
    .leftJoin(businesses, eq(businesses.id, emailEvents.businessId))
    .where(and(inArray(emailEvents.status, [...EMAIL_PROBLEM_STATUSES]), gte(emailEvents.updatedAt, since)))
    .orderBy(desc(emailEvents.updatedAt), desc(emailEvents.id))
    .limit(50);
  return rows.map((r) => {
    const why = r.details.reason ?? r.details.error;
    return {
      id: r.id,
      at: r.at.toISOString(),
      template: r.template,
      toMasked: r.toMasked,
      business: r.businessId !== null && r.businessName !== null ? { id: r.businessId, name: r.businessName } : null,
      status: r.status as EmailProblemStatus,
      detail: typeof why === 'string' ? why : null,
    };
  });
}

export async function getSystemHealth(deps: HealthDeps, now: Date = new Date()): Promise<SystemHealth> {
  const started = performance.now();

  let database: HealthTile;
  const pingStart = performance.now();
  try {
    await deps.db.execute(sql`select 1`);
    const ms = Math.round(performance.now() - pingStart);
    database = tile(ms > SLOW_MS ? 'warn' : 'ok', { ms });
  } catch {
    database = tile('down');
  }

  const dbUp = database.light !== 'down';
  const [paymentChecks, failedJobs, emailProblems] = dbUp
    ? await Promise.all([
        listPaymentChecks(deps.db),
        deps.jobs.listFailed(new Date(now.getTime() - HEALTH_LOOKBACK_DAYS * DAY_MS)),
        listEmailProblems(deps.db, now),
      ])
    : [[], [], []];
  // A cheap second look so "ToyyibPay · N to check" counts everything, not just the 100 shown.
  const toCheck = dbUp ? await countPaymentChecks(deps.db) : 0;

  const apiMs = Math.round(performance.now() - started);
  const jobsOn = deps.env.JOBS_ENABLED;
  const emailOff = deps.env.MAIL_TRANSPORT === 'console';
  return {
    checkedAt: now.toISOString(),
    api: tile(apiMs > SLOW_MS ? 'warn' : 'ok', { ms: apiMs }),
    database,
    toyyibpay: tile(countLight(toCheck), { count: toCheck }),
    // Something to look at always shows; "off" only says why there is nothing to see.
    jobs:
      failedJobs.length > 0
        ? tile('warn', { count: failedJobs.length })
        : jobsOn
          ? tile('ok', { count: 0 })
          : tile('off', { note: 'jobs_off' }),
    email:
      emailProblems.length > 0
        ? tile('warn', { count: emailProblems.length })
        : emailOff
          ? tile('off', { note: 'console' })
          : deps.env.RESEND_WEBHOOK_SECRET
            ? tile('ok', { count: 0 })
            : tile('off', { count: 0, note: 'webhook_off' }),
    push: deps.env.EXPO_ACCESS_TOKEN ? tile('ok') : tile('off', { note: 'no_token' }),
    paymentChecks,
    failedJobs,
    emailProblems,
  };
}
