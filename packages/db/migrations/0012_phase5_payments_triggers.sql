-- Custom migration: updated_at triggers for payments / payment_accounts.
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER payment_accounts_set_updated_at BEFORE UPDATE ON payment_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
