-- Custom migration: rest of schema.sql section 6 — receipt number sequence, updated_at triggers, default rows (section 9).

-- Plan payment receipts (I15, I17, M4). The API sets
-- payments.receipt_no = 'OB-' || year || '-' || lpad(nextval('receipt_no_seq')::text, 6, '0') when a plan payment is paid.
CREATE SEQUENCE receipt_no_seq;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'two_factors','admin_business_notes','plans','platform_settings','support_cases','support_notes',
    'privacy_requests','announcements','announcement_dismissals','payment_checks','email_events'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Default rows; edited later in I12.
INSERT INTO platform_settings (id) VALUES (1);
--> statement-breakpoint
INSERT INTO plans (code, name, price_sen, resource_limit, extra_resource_sen, features, sort_order) VALUES
  ('starter',  'Starter',  4900, 3,  1000, '{"online_payment":true,"staff_app":false,"reports":false}', 1),
  ('business', 'Business', 9900, 10, 1000, '{"online_payment":true,"staff_app":true,"reports":true}',  2);
