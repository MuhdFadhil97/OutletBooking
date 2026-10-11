-- Custom migration: keep updated_at current on the platform admin tables (schema.sql section 6).
CREATE TRIGGER platform_admins_set_updated_at BEFORE UPDATE ON platform_admins
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER admin_audit_log_set_updated_at BEFORE UPDATE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
