-- Custom migration: updated_at triggers for booking_events / refunds, and a 'created'
-- event for bookings made before booking_events existed (so every timeline starts somewhere).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['booking_events','refunds'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END $$;
--> statement-breakpoint
INSERT INTO booking_events (business_id, booking_id, event_type, actor_user_id, details, created_at)
SELECT b.business_id, b.id, 'created', b.created_by_user_id,
       jsonb_build_object('source', b.source, 'backfilled', true), b.created_at
FROM bookings b
WHERE NOT EXISTS (SELECT 1 FROM booking_events e WHERE e.booking_id = b.id);
