import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { AppEnv } from '../types';

export const healthRoutes = new Hono<AppEnv>().get('/', async (c) => {
  let db: 'ok' | 'down' = 'ok';
  try {
    await c.var.db.execute(sql`select 1`);
  } catch {
    db = 'down';
  }
  return c.json({ status: db === 'ok' ? 'ok' : 'degraded', db, time: new Date().toISOString() }, db === 'ok' ? 200 : 503);
});
