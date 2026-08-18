-- 049_territory_areas_rls_and_booking_session_index.sql
-- Two security/correctness gaps found in the August 2026 bug sweep:
--
-- 1. da_territory_areas (014) was the only table never given RLS, so with
--    Supabase's default grants the anon key — shipped in the public booking
--    widget bundle — could SELECT/INSERT/UPDATE/DELETE the numbered franchise
--    areas via PostgREST. Standard 010 pattern: HQ full access, franchisee
--    reads their own areas. Only src/features/hq/* queries this table today.
--
-- 2. da_bookings.stripe_checkout_session_id (003) had no unique index, so the
--    M2 Payment Link webhook's SELECT-then-INSERT idempotency could double-book
--    on concurrent deliveries of the same checkout.session.completed event.
--    Mirror of 044's idx_product_sales_checkout_session; partial because most
--    bookings (manual/M3 pending flow) carry NULL.

ALTER TABLE da_territory_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_full_access" ON da_territory_areas
  FOR ALL USING (is_hq_user());

CREATE POLICY "franchisee_own_read" ON da_territory_areas
  FOR SELECT USING (franchisee_id = get_current_franchisee_id());

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_checkout_session
  ON da_bookings (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
