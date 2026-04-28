-- 007_triggers.sql
-- update_updated_at() function + per-table triggers
-- da_territories_set_geom(), da_course_instances_set_geom() + their triggers
-- Reference: docs/PRD-technical.md §4.1 (updated_at convention) and §4.3 (territory geom).

-- update_updated_at -----------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Tables with updated_at columns (10 of 15):
-- da_franchisees, da_territories, da_course_templates, da_course_instances,
-- da_customers, da_private_clients, da_bookings, da_interest_forms,
-- da_discount_codes, da_settings.
-- Tables WITHOUT updated_at (no trigger): da_ticket_types, da_medical_declarations,
-- da_billing_runs, da_email_sequences, da_activities.

CREATE TRIGGER trg_franchisees_updated_at
  BEFORE UPDATE ON da_franchisees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_territories_updated_at
  BEFORE UPDATE ON da_territories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_course_templates_updated_at
  BEFORE UPDATE ON da_course_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_course_instances_updated_at
  BEFORE UPDATE ON da_course_instances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON da_customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_private_clients_updated_at
  BEFORE UPDATE ON da_private_clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON da_bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_interest_forms_updated_at
  BEFORE UPDATE ON da_interest_forms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_discount_codes_updated_at
  BEFORE UPDATE ON da_discount_codes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_settings_updated_at
  BEFORE UPDATE ON da_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- da_territories_set_geom -----------------------------------------------------
-- PRD §4.3.

CREATE OR REPLACE FUNCTION da_territories_set_geom()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.geom = ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_territories_geom
  BEFORE INSERT OR UPDATE ON da_territories
  FOR EACH ROW EXECUTE FUNCTION da_territories_set_geom();

-- da_course_instances_set_geom -----------------------------------------------
-- PRD §4.5 — same pattern as territories.

CREATE OR REPLACE FUNCTION da_course_instances_set_geom()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.geom = ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_course_instances_geom
  BEFORE INSERT OR UPDATE ON da_course_instances
  FOR EACH ROW EXECUTE FUNCTION da_course_instances_set_geom();
