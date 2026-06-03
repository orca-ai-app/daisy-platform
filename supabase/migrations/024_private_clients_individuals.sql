-- 024_private_clients_individuals.sql
-- "Clients" can now be individuals, not just organisations/schools.
--
-- Adds client_type and makes company_name optional. Individuals carry their name
-- in contact_name (no company). Existing rows backfill to 'organisation' (they
-- already have a company_name), so the new CHECK passes for all of them.
-- The existing UNIQUE(franchisee_id, company_name) still applies to
-- organisations; individuals have company_name = NULL and Postgres treats NULLs
-- as distinct, so they never collide.

ALTER TABLE da_private_clients
  ADD COLUMN IF NOT EXISTS client_type TEXT NOT NULL DEFAULT 'organisation'
    CHECK (client_type IN ('organisation', 'individual'));

ALTER TABLE da_private_clients ALTER COLUMN company_name DROP NOT NULL;

-- Organisations must have a company name; individuals must have a contact name.
ALTER TABLE da_private_clients
  DROP CONSTRAINT IF EXISTS da_private_clients_name_present;
ALTER TABLE da_private_clients
  ADD CONSTRAINT da_private_clients_name_present CHECK (
    (client_type = 'organisation' AND company_name IS NOT NULL AND length(btrim(company_name)) > 0)
    OR (client_type = 'individual' AND contact_name IS NOT NULL AND length(btrim(contact_name)) > 0)
  );

COMMENT ON COLUMN da_private_clients.client_type IS
  'organisation (school/company, uses company_name) or individual (a person, uses contact_name as their name).';

-- Email is the identity key for individuals. Enforce one individual client per
-- email per franchisee, and index it so the M3 booking flow can match a booker's
-- email to an existing client (attribute the booking) instead of creating a dupe.
CREATE UNIQUE INDEX IF NOT EXISTS uq_da_private_clients_individual_email
  ON da_private_clients (franchisee_id, lower(contact_email))
  WHERE client_type = 'individual' AND contact_email IS NOT NULL;
