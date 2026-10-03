-- Custom migration: keep updated_at current on every Phase 1 table.
-- Later phases add triggers for their own tables in their own migrations.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','sessions','accounts','verifications','push_tokens',
    'businesses','business_members','subscriptions'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END $$;
