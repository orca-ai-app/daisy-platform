-- 013_territory_number.sql
-- Adds the `territory_number` column to da_territories so multiple postcode rows
-- can be grouped under the same Daisy territory grant (1-312).
--
-- Background: Daisy's franchise contracts are sold by territory NUMBER, where
-- each number covers 1..N postcode districts. The original PRD §4.3 schema
-- had da_territories.postcode_prefix UNIQUE — i.e. one row per postcode — but
-- didn't expose the parent territory grouping. This column adds it.
--
-- Real-data import (2026-04-30) populated 312 territory numbers across 2,814
-- postcode rows. 881 of those are claimed by 61 real franchisees; the
-- remaining 1,933 are owned by Jenni's HQ row with status='vacant'.
--
-- The Daisy auth trigger from migration 012 still does the work of linking
-- new auth.users to da_franchisees by email — territory_number doesn't
-- intersect with that.

ALTER TABLE da_territories
  ADD COLUMN IF NOT EXISTS territory_number INTEGER;

CREATE INDEX IF NOT EXISTS idx_territories_territory_number
  ON da_territories(territory_number);

-- The schema_migrations row is inserted by scripts/apply-migrations.sh.
