-- 042_prelaunch_discounts.sql
-- Adds da_discount_codes.group_name — a lightweight label shared by a batch of
-- single-use codes created together (pre-launch NTH-6/NTH-10). NULL for
-- standalone codes. The franchisee discounts UI filters and counts per group;
-- create-discount-code stamps it when generating a batch.
--
-- This is migration 042 — do NOT renumber.

ALTER TABLE da_discount_codes
  ADD COLUMN group_name TEXT;

CREATE INDEX idx_da_discount_codes_franchisee_group
  ON da_discount_codes (franchisee_id, group_name);

COMMENT ON COLUMN da_discount_codes.group_name IS
  'Batch label for single-use code groups (migration 042). NULL = standalone code.';
