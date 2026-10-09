import { PgBoss } from 'pg-boss';
import type { Db } from '@outletbooking/db';
import type { Env } from '../env';
import { staffDaySummary, trialReminders } from '../services/daily';
import { expirePendingBookings, notifyExpired, type PaymentDeps } from '../services/payments';
import type { PushSender } from '../services/push';
import type { ToyyibPayClient } from '../services/toyyibpay';

const TZ = 'Asia/Kuala_Lumpur';

/** Job name → cron (Malaysia time). Each job's logic lives in services/ and is tested there. */
const SCHEDULES = {
  'expire-pending-bookings': '* * * * *', // every minute (BR-04, FR-09.3)
  'staff-day-summary': '30 7 * * *', // 7:30 AM (FR-10.2)
  'trial-reminders': '0 9 * * *', // 9:00 AM (FR-16.2)
} as const;

/**
 * pg-boss keeps its queue in Postgres (schema `pgboss`), so no Redis is needed. Uses a direct /
 * session connection (not Supabase's transaction pooler).
 */
export async function startJobs(deps: { db: Db; env: Env; push: PushSender; toyyibpay: ToyyibPayClient }) {
  const boss = new PgBoss({ connectionString: deps.env.DATABASE_URL, schema: 'pgboss' });
  boss.on('error', (err) => console.error('[jobs]', err));
  await boss.start();

  const payments: PaymentDeps = deps;
  const handlers: Record<keyof typeof SCHEDULES, () => Promise<unknown>> = {
    'expire-pending-bookings': async () => {
      const expired = await expirePendingBookings(payments);
      for (const id of expired) await notifyExpired(payments, id);
      return expired.length;
    },
    'staff-day-summary': () => staffDaySummary(deps.db, deps.push),
    'trial-reminders': () => trialReminders(deps.db, deps.push),
  };

  for (const [name, cron] of Object.entries(SCHEDULES) as [keyof typeof SCHEDULES, string][]) {
    await boss.createQueue(name);
    await boss.schedule(name, cron, null, { tz: TZ });
    await boss.work(name, async () => {
      await handlers[name]();
    });
  }
  console.log(`Jobs running: ${Object.keys(SCHEDULES).join(', ')}`);
  return boss;
}
