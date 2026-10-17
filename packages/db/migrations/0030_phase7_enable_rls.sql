-- Hand-written: lock the tables away from Supabase's built-in web interface (Data API / PostgREST).
--
-- Supabase publishes the `public` schema to the internet through its Data API, and anyone holding the project's public
-- (anon) key could then read or change any table that has Row Level Security switched off. OutletBooking never uses that
-- interface: every query goes through our API, which connects as the table owner (`postgres` on Supabase, `outlet` locally)
-- and is not subject to row security. So we switch row security ON for every table with NO policies, which means
-- "nobody but the owner". This is plain PostgreSQL and changes nothing on a database that has no Supabase roles.
--
-- A new table must get the same treatment: the test in apps/api/test/rls.test.ts fails when a table in `public` has it off.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
--> statement-breakpoint
-- Belt and braces on Supabase only (the roles do not exist on plain Postgres): the web roles get no table or sequence rights at
-- all, now or for tables created later by the same role, so a future table cannot be exposed by a forgotten ENABLE.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  END IF;
END $$;
--> statement-breakpoint
-- Supabase's linter: a trigger function should not depend on the caller's search_path. `now()` lives in pg_catalog, which is
-- always searched, so an empty path changes nothing for this function.
ALTER FUNCTION public.set_updated_at() SET search_path = '';
