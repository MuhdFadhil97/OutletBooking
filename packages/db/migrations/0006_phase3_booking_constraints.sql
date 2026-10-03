-- Custom migration: no double booking + updated_at triggers for Phase 3 tables.

-- Same resource, overlapping blocked time (incl. buffers), active status → rejected (SQLSTATE 23P01).
-- Back-to-back is allowed ('[)' range); cancelled / no_show / completed free the slot.
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
  resource_id WITH =,
  tstzrange(blocked_start_at, blocked_end_at, '[)') WITH &&
) WHERE (status IN ('pending','confirmed','checked_in'));
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers','bookings'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END $$;
