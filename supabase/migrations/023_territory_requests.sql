-- 023_territory_requests.sql
-- Franchisees request a new/expanded territory from the portal (replaces the old
-- mailto: link). New requests surface in the HQ dashboard Attention list and are
-- actioned on a dedicated HQ page.

CREATE TABLE IF NOT EXISTS da_territory_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  franchisee_id UUID NOT NULL REFERENCES da_franchisees(id) ON DELETE CASCADE,
  area          TEXT NOT NULL,        -- desired postcode area(s) / region (free text)
  note          TEXT,                 -- context / reason
  status        TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'reviewing', 'approved', 'declined')),
  handled_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_da_territory_requests_franchisee_id
  ON da_territory_requests (franchisee_id);
CREATE INDEX IF NOT EXISTS idx_da_territory_requests_status
  ON da_territory_requests (status);

ALTER TABLE da_territory_requests ENABLE ROW LEVEL SECURITY;

-- Franchisee can read/insert their own requests; HQ has full access. Mirrors the
-- pattern on da_private_clients etc. (get_current_franchisee_id / is_hq_user).
DROP POLICY IF EXISTS franchisee_own ON da_territory_requests;
CREATE POLICY franchisee_own ON da_territory_requests
  FOR ALL TO authenticated
  USING (franchisee_id = get_current_franchisee_id());

DROP POLICY IF EXISTS hq_full_access ON da_territory_requests;
CREATE POLICY hq_full_access ON da_territory_requests
  FOR ALL TO authenticated
  USING (is_hq_user());
