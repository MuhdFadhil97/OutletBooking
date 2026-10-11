-- Custom migration: keep updated_at current on the pilot extras tables (schema.sql section 7).
CREATE TRIGGER listings_set_updated_at BEFORE UPDATE ON listings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER checklist_sections_set_updated_at BEFORE UPDATE ON checklist_sections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER checklist_items_set_updated_at BEFORE UPDATE ON checklist_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER inspection_results_set_updated_at BEFORE UPDATE ON inspection_results
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER inspection_item_results_set_updated_at BEFORE UPDATE ON inspection_item_results
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
