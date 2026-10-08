import { networkInterfaces } from 'node:os';
import { serve } from '@hono/node-server';
import { createDb } from '@outletbooking/db';
import { createApp } from './app';
import { createAuth } from './auth';
import { loadEnv } from './env';
import { startJobs } from './jobs';

const env = loadEnv();
const { db, sql } = createDb(env.DATABASE_URL, { prepare: env.DB_PREPARE });
const auth = createAuth(db, env);
const app = createApp({ db, auth, env });

// Listen on all interfaces so a phone on the same Wi-Fi can reach it.
const server = serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, ({ port }) => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i!.address}:${port}`);
  console.log(`API on http://localhost:${port}`);
  if (lan.length) console.log(`LAN: ${lan.join('  ')}  (use one as EXPO_PUBLIC_API_URL)`);
});

// Background jobs: expire unpaid holds, morning summaries, trial reminders.
const jobs = env.JOBS_ENABLED
  ? startJobs(db, env).catch((err: unknown) => {
      console.error('[jobs] not started:', err instanceof Error ? err.message : err);
      return null;
    })
  : Promise.resolve(null);

const shutdown = () => {
  server.close();
  void jobs
    .then((boss) => boss?.stop({ graceful: true, timeout: 5000 }))
    .finally(() => sql.end({ timeout: 5 }))
    .then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
