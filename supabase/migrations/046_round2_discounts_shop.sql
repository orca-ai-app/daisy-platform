-- 046_round2_discounts_shop.sql
-- Round 2 franchisee test-drive feedback (Hannah + Feola, 2026-08).
--
-- Three unrelated columns, grouped because they all landed in the same round:
--
--   G10 — da_discount_codes.template_ids: restrict a code to certain course
--         types. Hannah: "if we offer a 10% discount code for a 1 hour class,
--         we don't want customers using that code on a 2hr class."
--   G9  — da_products.franchisee_id: a franchisee's OWN shop item. Today the
--         catalogue is HQ-only, so Hannah cannot add her second e-learning
--         course and Feola cannot rename anything.
--   G2  — da_franchisees.booking_email_message: the franchisee's own words,
--         added to the confirmation email their customers receive.
--
-- This is migration 046 — do NOT renumber.

-- G10: da_discount_codes.template_ids ------------------------------------------
-- NULL or empty array = valid on every course type (the existing behaviour, so
-- every code already in the table keeps working untouched). A populated array
-- restricts the code to bookings whose course instance uses one of those
-- da_course_templates rows.
--
-- Deliberately a UUID[] rather than a join table: a code applies to a handful
-- of course types at most, it is only ever read whole (never joined against),
-- and create-discount-code validates every id against da_course_templates
-- before the insert. No FK is possible on an array element, so the Edge
-- Function is the integrity boundary.

ALTER TABLE da_discount_codes
  ADD COLUMN IF NOT EXISTS template_ids UUID[];

COMMENT ON COLUMN da_discount_codes.template_ids IS
  'Course types this code may be redeemed against (migration 046). NULL or empty array = valid on everything. Populated = only bookings whose course instance uses one of these da_course_templates ids. Validated in create-discount-code; enforced at redemption in create-checkout-session / validate-discount.';

-- G9: da_products.franchisee_id -------------------------------------------------
-- NULL = an HQ network-catalogue item, visible to every franchisee and editable
-- only by HQ (the behaviour of every existing row). Set = that franchisee's own
-- item: only they see it, only they can edit or delete it, and HQ can still see
-- and manage everything.

ALTER TABLE da_products
  ADD COLUMN IF NOT EXISTS franchisee_id UUID REFERENCES da_franchisees(id) ON DELETE CASCADE;

COMMENT ON COLUMN da_products.franchisee_id IS
  'Owner of this catalogue item (migration 046). NULL = HQ network item, visible to the whole network and HQ-editable only. Set = this franchisee''s own item, visible and editable only to them (and HQ).';

CREATE INDEX IF NOT EXISTS idx_products_franchisee
  ON da_products (franchisee_id);

-- RLS — migration 038 gave da_products a blanket "all_read" for any signed-in
-- user plus "hq_write". Replace the read policy so a franchisee sees the HQ
-- catalogue plus their own items but not another franchisee's, and add
-- own-row insert/update/delete policies. HQ's FOR ALL policy is unchanged and
-- still covers every row.

DROP POLICY IF EXISTS "all_read" ON da_products;
CREATE POLICY "network_and_own_read" ON da_products
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND (franchisee_id IS NULL OR franchisee_id = get_current_franchisee_id())
  );

DROP POLICY IF EXISTS "franchisee_own_insert" ON da_products;
CREATE POLICY "franchisee_own_insert" ON da_products
  FOR INSERT WITH CHECK (
    franchisee_id IS NOT NULL AND franchisee_id = get_current_franchisee_id()
  );

DROP POLICY IF EXISTS "franchisee_own_update" ON da_products;
CREATE POLICY "franchisee_own_update" ON da_products
  FOR UPDATE
  USING (franchisee_id IS NOT NULL AND franchisee_id = get_current_franchisee_id())
  WITH CHECK (franchisee_id IS NOT NULL AND franchisee_id = get_current_franchisee_id());

DROP POLICY IF EXISTS "franchisee_own_delete" ON da_products;
CREATE POLICY "franchisee_own_delete" ON da_products
  FOR DELETE USING (
    franchisee_id IS NOT NULL AND franchisee_id = get_current_franchisee_id()
  );

-- G2: da_franchisees.booking_email_message ---------------------------------------
-- Free text the franchisee writes once in their profile; send-emails renders it
-- in a separated block on the booking confirmation and the product purchase
-- confirmation. NULL = nothing extra is added.

ALTER TABLE da_franchisees
  ADD COLUMN IF NOT EXISTS booking_email_message TEXT;

COMMENT ON COLUMN da_franchisees.booking_email_message IS
  'The franchisee''s own message added to the confirmation emails their customers receive (migration 046). Plain text, trimmed, max 1500 characters, set via update-franchisee-self. NULL = nothing extra is added.';
