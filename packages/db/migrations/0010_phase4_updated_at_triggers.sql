-- Custom migration: keep updated_at current on payments and notifications.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payments','notifications'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END $$;
