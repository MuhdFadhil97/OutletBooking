import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestContext } from './helpers';

/**
 * Supabase publishes the `public` schema over its Data API. Every table must have Row Level Security switched on (with no
 * policies) so that only our API, connecting as the table owner, can read or write it. See migration 0030.
 */
const ctx = createTestContext();
afterAll(() => ctx.close());

describe('row level security', () => {
  it('is on for every table in the public schema (a new table needs ENABLE ROW LEVEL SECURITY in its migration)', async () => {
    const rows = (await ctx.db.execute(sql`
      select c.relname as name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
      order by 1`)) as unknown as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual([]);
  });

  it('has no policies, so only the owner role (our API) can read or write', async () => {
    const rows = (await ctx.db.execute(sql`select count(*)::int as n from pg_policies where schemaname = 'public'`)) as unknown as { n: number }[];
    expect(rows[0]!.n).toBe(0);
  });

  it('does not stop the API: the owner still reads and writes as before', async () => {
    const rows = (await ctx.db.execute(sql`select count(*)::int as n from plans`)) as unknown as { n: number }[];
    expect(rows[0]!.n).toBeGreaterThan(0);
  });

  it('keeps updated_at working with the function’s empty search_path', async () => {
    await ctx.reset();
    await ctx.db.execute(sql`insert into leads (reason, name, phone, consent_at) values ('demo', 'RLS Check', '+60123456789', now())`);
    const before = (await ctx.db.execute(sql`select updated_at from leads limit 1`)) as unknown as { updated_at: string | Date }[];
    await new Promise((r) => setTimeout(r, 20));
    await ctx.db.execute(sql`update leads set name = 'RLS Check 2'`);
    const after = (await ctx.db.execute(sql`select updated_at from leads limit 1`)) as unknown as { updated_at: string | Date }[];
    expect(new Date(after[0]!.updated_at).getTime()).toBeGreaterThan(new Date(before[0]!.updated_at).getTime());
  });
});
