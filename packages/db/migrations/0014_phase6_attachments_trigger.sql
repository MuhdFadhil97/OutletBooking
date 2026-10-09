-- Custom migration: keep updated_at current on booking_attachments.
CREATE TRIGGER booking_attachments_set_updated_at BEFORE UPDATE ON booking_attachments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
