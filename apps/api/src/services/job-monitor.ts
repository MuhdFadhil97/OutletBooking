import { sql } from 'drizzle-orm';
import type { Db } from '@outletbooking/db';
import type { FailedJobItem } from '@outletbooking/shared';
import { AppError } from '../errors';

/**
 * I27 · Background jobs (pg-boss keeps them in Postgres, schema `pgboss`). The health page lists the jobs that ended
 * `failed` and lets an admin retry one. Tests pass a fake; production reads pg-boss's own table.
 */
export interface JobMonitor {
  /** Jobs that failed since `since`, newest first. An empty list when jobs are off or pg-boss has not been set up. */
  listFailed(since: Date): Promise<FailedJobItem[]>;
  /** Put a failed job back in the queue. */
  retry(name: string, id: string): Promise<void>;
}

/** What the API uses when background jobs are not running (`JOBS_ENABLED=false`, tests): nothing to show, nothing to retry. */
export const noJobMonitor: JobMonitor = {
  listFailed: async () => [],
  retry: async () => {
    throw new AppError(503, 'jobs_off', 'Background jobs are not running on this server');
  },
};

interface FailedRow {
  id: string;
  name: string;
  retry_count: number;
  retry_limit: number;
  completed_on: Date | string | null;
  output: unknown;
}

/** The error a job ended with, as short readable text (pg-boss stores `{ message, … }`). */
export function errorText(output: unknown): string {
  if (output && typeof output === 'object') {
    const message = (output as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message.slice(0, 300);
  }
  if (typeof output === 'string' && output) return output.slice(0, 300);
  return 'No error text was saved';
}

/** The subset of pg-boss the monitor needs. */
export interface RetryableBoss {
  retry(name: string, id: string): Promise<unknown>;
}

export function pgBossMonitor(db: Db, getBoss: () => RetryableBoss | null): JobMonitor {
  return {
    async listFailed(since) {
      let rows: FailedRow[];
      try {
        rows = (await db.execute(sql`
          select id::text as id, name, retry_count, retry_limit, completed_on, output
          from pgboss.job
          where state = 'failed' and name not like '\_\_pgboss%' and completed_on >= ${since.toISOString()}
          order by completed_on desc
          limit 50`)) as unknown as FailedRow[];
      } catch (err) {
        // pg-boss creates its schema when the first server starts; before that there is simply nothing to list.
        if ((err as { code?: string }).code === '42P01' || (err as { cause?: { code?: string } }).cause?.code === '42P01') return [];
        throw err;
      }
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        error: errorText(r.output),
        tries: r.retry_count + 1,
        maxTries: r.retry_limit + 1,
        failedAt: new Date(r.completed_on ?? Date.now()).toISOString(),
      }));
    },
    async retry(name, id) {
      const boss = getBoss();
      if (!boss) throw new AppError(503, 'jobs_off', 'Background jobs are not running on this server');
      await boss.retry(name, id);
    },
  };
}
