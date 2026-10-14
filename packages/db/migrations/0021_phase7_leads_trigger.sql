-- Custom migration: keep updated_at current on leads (schema.sql section 6).
CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
