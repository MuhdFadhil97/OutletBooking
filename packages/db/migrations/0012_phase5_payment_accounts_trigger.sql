-- Custom migration: keep updated_at current on payment_accounts.
CREATE TRIGGER payment_accounts_set_updated_at BEFORE UPDATE ON payment_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
