-- 038_merchandise.sql
-- Merchandise (Jenni, 2026-07-13): HQ-managed product catalogue + franchisee
-- in-person sales ledger. Replaces the BookWhen merchandise listing. Merch
-- revenue joins the franchisee's territory revenue pool in the monthly
-- max(base fee, 10%) calculation (preview-billing-run). The in-class booking
-- upsell needs no schema — it's a combined ticket type ("Class + book").
--
-- This is migration 038 — do NOT renumber.

-- da_products -------------------------------------------------------------------
-- The network catalogue. HQ-managed; franchisees read it to record sales.

CREATE TABLE da_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  rrp_pence INTEGER NOT NULL CHECK (rrp_pence >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON da_products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE da_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all_read" ON da_products
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "hq_write" ON da_products
  FOR ALL USING (is_hq_user());

-- da_product_sales ----------------------------------------------------------------
-- One row per in-person sale (books at a class, kits, posted orders recorded
-- manually). unit_price_pence is editable at sale time (postage/discounts);
-- total_pence is computed server-side in create-product-sale.

CREATE TABLE da_product_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  franchisee_id UUID NOT NULL REFERENCES da_franchisees(id),
  product_id UUID NOT NULL REFERENCES da_products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_pence INTEGER NOT NULL CHECK (unit_price_pence >= 0),
  total_pence INTEGER NOT NULL CHECK (total_pence >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'other')),
  sold_at DATE NOT NULL,
  course_instance_id UUID REFERENCES da_course_instances(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_product_sales_franchisee ON da_product_sales (franchisee_id, sold_at);
CREATE INDEX idx_product_sales_sold_at ON da_product_sales (sold_at);

ALTER TABLE da_product_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_full_access" ON da_product_sales
  FOR ALL USING (is_hq_user());

CREATE POLICY "franchisee_own" ON da_product_sales
  FOR ALL USING (franchisee_id = get_current_franchisee_id());

-- Seed the current catalogue (Jenni, 2026-07-09). First Aid Kit has no agreed
-- price yet — seeded inactive; HQ activates it from /hq/products once priced.
INSERT INTO da_products (name, rrp_pence, active, sort_order) VALUES
  ('Paediatric First Aid book', 500, true, 1),
  ('Basic Life Saving First Aid book', 500, true, 2),
  ('Concise First Aid book', 700, true, 3),
  ('First Aid Kit', 0, false, 4);
