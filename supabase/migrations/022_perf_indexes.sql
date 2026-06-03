-- 022_perf_indexes.sql
-- Performance: index the columns RLS and the hot franchisee joins filter on.
--
-- Root cause of the slow franchisee lookups: every franchisee RLS policy is
-- `<col> = get_current_franchisee_id()`, and that STABLE helper runs
-- `SELECT id FROM da_franchisees WHERE auth_user_id = auth.uid()`. With no index
-- on auth_user_id, each query sequentially scans da_franchisees to resolve the
-- caller. The remaining indexes cover FK columns that back common joins/filters
-- (course detail tickets, discounts, booking joins) that were missing a leading
-- index. All IF NOT EXISTS so this is a safe no-op where already present.

-- The big one: backs get_current_franchisee_id() on every franchisee query.
CREATE INDEX IF NOT EXISTS idx_da_franchisees_auth_user_id
  ON da_franchisees (auth_user_id);

-- RLS filter for the franchisee Discounts list.
CREATE INDEX IF NOT EXISTS idx_da_discount_codes_franchisee_id
  ON da_discount_codes (franchisee_id);

-- Course detail loads its ticket types by course_instance_id.
CREATE INDEX IF NOT EXISTS idx_da_ticket_types_course_instance_id
  ON da_ticket_types (course_instance_id);

-- Booking joins / detail.
CREATE INDEX IF NOT EXISTS idx_da_bookings_ticket_type_id
  ON da_bookings (ticket_type_id);

CREATE INDEX IF NOT EXISTS idx_da_bookings_private_client_id
  ON da_bookings (private_client_id);
