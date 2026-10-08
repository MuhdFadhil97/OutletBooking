import { PgBoss } from 'pg-boss';
import type { Db } from '@outletbooking/db';
import type { Env } from '../env';
import { Outbox } from '../services/notifications';
import { createPaymentDeps } from '../services/payments';
import { createPushSender } from '../services/push';
import { expireUnpaidBookings, sendDaySummaries, sendTrialReminders } from '../services/scheduled';

/**
 * pg-boss (Postgres-backed queue, its own `pgboss` schema). Cron schedules are stored in the
 * database, so with several API instances each job still runs once per tick.
 * Needs a session connection (not Supabase's transaction pooler): JOBS_DATABASE_URL, else DATABASE_URL.
 */
const JOBS = {
  'expire-unpaid-bookings': { cron: '* * * * *' },
  'day-summary': { cron: '2 * * * *' },
  'trial-reminders': { cron: '17 * * * *' },
} as const;

export async function startJobs(db: Db, env: Env): Promise<PgBoss> {
  const boss = new PgBoss(env.JOBS_DATABASE_URL ?? env.DATABASE_URL);
  boss.on('error', (err) => console.error('[jobs]', err.message));
  await boss.start();

  const payments = createPaymentDeps(env);
  const push = createPushSender(env);
  const run = async (name: keyof typeof JOBS) => {
    const outbox = new Outbox();
    let result: number;
    if (name === 'expire-unpaid-bookings') result = await expireUnpaidBookings(db, payments, outbox);
    else if (name === 'day-summary') result = await sendDaySummaries(db, push);
    else result = await sendTrialReminders(db, outbox);
    await outbox.flush(db, push);
    if (result) console.log(`[jobs] ${name}: ${result}`);
  };

  for (const [name, { cron }] of Object.entries(JOBS) as [keyof typeof JOBS, { cron: string }][]) {
    await boss.createQueue(name);
    await boss.schedule(name, cron, null, { tz: 'UTC' });
    await boss.work(name, async () => {
      await run(name);
    });
  }
  console.log(`[jobs] running: ${Object.keys(JOBS).join(', ')}`);
  return boss;
}
