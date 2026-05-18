-- 014_territory_areas.sql
-- Introduces da_territory_areas, the numbered franchise grants that sit ABOVE
-- da_territories (postcode prefixes). One franchisee owns 1+ areas; each area
-- contains 1+ postcode prefixes.
--
-- Background: Jenni Dunman's client feedback (May 2026) flagged that the
-- dashboard's "1,949 territories vacant" KPI was wrong — it counts vacant
-- postcode prefixes rather than vacant *numbered areas*. Helen Beale =
-- "Daisy First Aid Sutton" = Territory 57; Pip May owns areas 15 (Bath) and
-- 16 (Bristol). The CSV at docs/franchisee-territory-postcodes.csv maps the
-- ~300 numbered areas to postcode prefixes and franchisees.
--
-- Reference: plan §3 "014_territory_areas.sql" in
-- ~/.claude/plans/working-from-volumes-external-home-dev-o-sunny-truffle.md.
--
-- Population happens via scripts/seed-territory-areas.ts (separate agent) —
-- this migration only sets up the structure.

CREATE TABLE da_territory_areas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number         INTEGER NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  franchisee_id  UUID REFERENCES da_franchisees(id) ON DELETE SET NULL,
  dfa_pg_url     TEXT,
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'vacant', 'reserved')),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE  da_territory_areas IS 'Numbered franchise areas (e.g. "Sutton" = #57). One franchisee owns 1+ areas; each area contains 1+ postcode prefixes (da_territories.territory_area_id).';
COMMENT ON COLUMN da_territory_areas.number IS 'The territory number used in contracts and conversation ("Territory 57"). Unique across the network.';
COMMENT ON COLUMN da_territory_areas.name IS 'Human-readable area name (e.g. "Sutton", "Bath"). Used to build da_franchisees.business_name.';
COMMENT ON COLUMN da_territory_areas.dfa_pg_url IS 'WordPress page URL from docs/franchisee-territory-postcodes.csv (one per area).';
COMMENT ON COLUMN da_territory_areas.status IS 'active = assigned to a franchisee; vacant = open for recruitment; reserved = held for a candidate in onboarding.';

CREATE INDEX idx_territory_areas_franchisee_id ON da_territory_areas(franchisee_id);
CREATE INDEX idx_territory_areas_status        ON da_territory_areas(status);

-- Link postcode-prefix territories up to their parent area --------------------
ALTER TABLE da_territories
  ADD COLUMN territory_area_id UUID REFERENCES da_territory_areas(id) ON DELETE SET NULL;

COMMENT ON COLUMN da_territories.territory_area_id IS 'Parent numbered area. NULL until the seed-territory-areas.ts script links postcodes to their area via the CSV.';

CREATE INDEX idx_territories_area_id ON da_territories(territory_area_id);
