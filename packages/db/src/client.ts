import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export interface CreateDbOptions {
  /** Set false for the Supabase Transaction pooler (port 6543). */
  prepare?: boolean;
  max?: number;
}

export function createDb(url: string, opts: CreateDbOptions = {}) {
  const sql = postgres(url, { prepare: opts.prepare ?? true, max: opts.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

export type Db = ReturnType<typeof createDb>['db'];
/** A Drizzle transaction handle (same query API as Db). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
