-- Custom migration: keep updated_at current on every Phase 2 table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'staff_invitations','branches','resources','services','service_price_rules',
    'resource_services','working_hours','time_off','booking_fields'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END $$;
