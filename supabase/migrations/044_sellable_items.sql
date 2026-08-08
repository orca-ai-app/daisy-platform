-- 044_sellable_items.sql
-- Sellable items (Feola, 2026-08): "Our e-learning courses go onto our booking
-- site and these need to be visible all the time rather than having a set date."
-- E-learning is handled like books and merchandise — an ITEM, not a dated event.
--
-- Migration 038 gave us an HQ catalogue (da_products) plus a franchisee-only
-- MANUAL sales ledger (da_product_sales). There was no public purchase path at
-- all. This migration adds the schema behind one:
--
--   1. da_products gains kind ('physical' | 'elearning') plus the fulfilment
--      fields an e-learning buyer needs after payment (the access link).
--   2. da_franchisee_products — a franchisee's decision to sell a catalogue
--      product online, at their OWN price. HQ owns the catalogue and the RRP;
--      the franchisee owns whether it is listed and what it costs, exactly as
--      they own their course prices.
--   3. da_product_sales gains the online-checkout columns. Online purchases
--      land in the SAME ledger as in-person sales, so franchisee sales
--      reporting and HQ billing (preview-billing-run pools da_product_sales
--      total_pence into the territory max(base, 10%) test — it filters only on
--      franchisee_id + sold_at, never on channel) already include them with no
--      billing change required.
--   4. da_email_sequences gains 'product_purchase_confirmation' and, because a
--      product purchase has NO booking, a nullable booking_id + product_sale_id.
--
-- payment_method for online sales reuses the existing 'card' value from 038's
-- CHECK (cash/card/other) — a Stripe Checkout card payment IS a card payment,
-- so no new enum value is needed. channel tells the two apart.
--
-- This is migration 044 — do NOT renumber.

-- da_products -------------------------------------------------------------------

ALTER TABLE da_products
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'physical'
    CHECK (kind IN ('physical', 'elearning'));

ALTER TABLE da_products
  ADD COLUMN IF NOT EXISTS fulfilment_url TEXT;

ALTER TABLE da_products
  ADD COLUMN IF NOT EXISTS fulfilment_notes TEXT;

COMMENT ON COLUMN da_products.kind IS
  'physical = books, kits, anything posted or handed over in person. elearning = an online course the buyer accesses via fulfilment_url immediately after payment.';
COMMENT ON COLUMN da_products.fulfilment_url IS
  'Where an e-learning buyer is sent after payment (https). Surfaced in the product_purchase_confirmation email. NULL for physical products.';
COMMENT ON COLUMN da_products.fulfilment_notes IS
  'Free-text fulfilment instructions shown to the buyer (e.g. "your login is your email address"). Optional for both kinds.';

-- da_franchisee_products ----------------------------------------------------------
-- One row per (franchisee, catalogue product) the franchisee has chosen to
-- offer. is_online is the customer-visible switch; price_pence is theirs to
-- set (da_products.rrp_pence is guidance only). No row = not offered.

CREATE TABLE IF NOT EXISTS da_franchisee_products (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  franchisee_id  UUID NOT NULL REFERENCES da_franchisees(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL REFERENCES da_products(id) ON DELETE CASCADE,
  price_pence    INTEGER NOT NULL CHECK (price_pence >= 0),
  is_online      BOOLEAN NOT NULL DEFAULT FALSE,
  vat_rate       NUMERIC(4,2),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (franchisee_id, product_id)
);

COMMENT ON TABLE  da_franchisee_products IS
  'A franchisee''s decision to sell a catalogue product online at their own price (migration 044). Absent row = not offered.';
COMMENT ON COLUMN da_franchisee_products.price_pence IS
  'The franchisee''s own selling price. Prefilled from da_products.rrp_pence in the portal, but theirs to change.';
COMMENT ON COLUMN da_franchisee_products.is_online IS
  'TRUE = visible to customers via get-public-items and buyable via create-checkout-session. FALSE = kept for in-person pricing only.';
COMMENT ON COLUMN da_franchisee_products.vat_rate IS
  'Optional VAT rate percentage the price includes (e.g. 20.00), matching da_ticket_types.vat_rate (migration 040). Display only.';

CREATE INDEX IF NOT EXISTS idx_franchisee_products_franchisee
  ON da_franchisee_products (franchisee_id);
CREATE INDEX IF NOT EXISTS idx_franchisee_products_online
  ON da_franchisee_products (franchisee_id, is_online);

DROP TRIGGER IF EXISTS trg_franchisee_products_updated_at ON da_franchisee_products;
CREATE TRIGGER trg_franchisee_products_updated_at
  BEFORE UPDATE ON da_franchisee_products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS — same shape as da_product_sales (038): HQ sees everything, a franchisee
-- sees only their own rows. No anon/public policy: the customer-facing read
-- goes through the get-public-items Edge Function on the service role.
ALTER TABLE da_franchisee_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hq_full_access" ON da_franchisee_products;
CREATE POLICY "hq_full_access" ON da_franchisee_products
  FOR ALL USING (is_hq_user());

DROP POLICY IF EXISTS "franchisee_own" ON da_franchisee_products;
CREATE POLICY "franchisee_own" ON da_franchisee_products
  FOR ALL USING (franchisee_id = get_current_franchisee_id());

-- da_product_sales ----------------------------------------------------------------
-- Online purchases land here alongside the manual in-person ledger, so nothing
-- downstream (franchisee sales reporting, preview-billing-run) needs changing.

ALTER TABLE da_product_sales
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT;

ALTER TABLE da_product_sales
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;

ALTER TABLE da_product_sales
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES da_customers(id);

ALTER TABLE da_product_sales
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'in_person'
    CHECK (channel IN ('in_person', 'online'));

ALTER TABLE da_product_sales
  ADD COLUMN IF NOT EXISTS franchisee_product_id UUID REFERENCES da_franchisee_products(id);

COMMENT ON COLUMN da_product_sales.channel IS
  'in_person = manually recorded by the franchisee (create-product-sale). online = a Stripe Checkout purchase finalised by stripe-webhook (migration 044).';
COMMENT ON COLUMN da_product_sales.stripe_checkout_session_id IS
  'Stripe Checkout session for an online sale. The webhook''s idempotency key — a retry finds the row and skips.';
COMMENT ON COLUMN da_product_sales.customer_id IS
  'The buyer (online sales). NULL for in-person sales, which capture no customer details.';

-- Idempotency key for the webhook: one sale per Stripe session. Partial so the
-- NULLs on every in-person row do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_sales_checkout_session
  ON da_product_sales (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_sales_customer
  ON da_product_sales (customer_id);

-- da_email_sequences --------------------------------------------------------------
-- A product purchase has no booking, so booking_id must become nullable and a
-- product_sale_id added for send-emails to resolve the row against.

ALTER TABLE da_email_sequences
  ALTER COLUMN booking_id DROP NOT NULL;

ALTER TABLE da_email_sequences
  ADD COLUMN IF NOT EXISTS product_sale_id UUID REFERENCES da_product_sales(id) ON DELETE CASCADE;

COMMENT ON COLUMN da_email_sequences.booking_id IS
  'The booking this email belongs to. NULL for product-purchase emails (migration 044), which carry product_sale_id instead.';
COMMENT ON COLUMN da_email_sequences.product_sale_id IS
  'The product sale this email belongs to (migration 044). Set only for product_purchase_confirmation; NULL for the booking journey.';

CREATE INDEX IF NOT EXISTS idx_email_sequences_product_sale
  ON da_email_sequences (product_sale_id);

-- Exactly one anchor per row — a queued email belongs to a booking OR a product
-- sale, never both and never neither.
ALTER TABLE da_email_sequences
  DROP CONSTRAINT IF EXISTS da_email_sequences_anchor_check;

ALTER TABLE da_email_sequences
  ADD CONSTRAINT da_email_sequences_anchor_check
  CHECK (
    (booking_id IS NOT NULL AND product_sale_id IS NULL)
    OR (booking_id IS NULL AND product_sale_id IS NOT NULL)
  );

-- The franchisee RLS policy (migration 010) scopes rows via booking_id, which
-- is NULL on product rows — those would be invisible to their own franchisee.
-- Extend it to cover the product-sale anchor too.
DROP POLICY IF EXISTS "franchisee_own" ON da_email_sequences;
CREATE POLICY "franchisee_own" ON da_email_sequences
  FOR ALL USING (
    booking_id IN (
      SELECT id FROM da_bookings
      WHERE franchisee_id = get_current_franchisee_id()
    )
    OR product_sale_id IN (
      SELECT id FROM da_product_sales
      WHERE franchisee_id = get_current_franchisee_id()
    )
  );

-- da_email_sequences.template_key CHECK — add 'product_purchase_confirmation' --
-- Same drop-and-recreate pattern as migration 040 (which this supersedes);
-- reproduces 040's full list plus the new key.

ALTER TABLE da_email_sequences
  DROP CONSTRAINT IF EXISTS da_email_sequences_template_key_check;

ALTER TABLE da_email_sequences
  ADD CONSTRAINT da_email_sequences_template_key_check
  CHECK (template_key IN (
    -- Kartra post-course journey
    'post_course_welcome',
    'recap_anaphylaxis',
    'recap_choking',
    'recap_head_injuries',
    'recap_cpr',
    'recap_febrile_convulsions',
    'recap_burns',
    'quiz_general',
    'refresher',
    'refresher_elearning_option',
    -- Transactional / notifications
    'new_booking_notification',
    'booking_confirmation',
    'medical_reminder',
    'interest_form_hq',
    'course_updated',
    'product_purchase_confirmation',
    -- Billing (Phase 2)
    'fee_invoice',
    'fee_chase_1',
    'fee_chase_2',
    'fee_failed',
    -- Legacy (migration 020) — kept for in-flight rows
    'thank_you',
    'refresher_6w',
    'refresher_3m',
    'refresher_6m',
    'refresher_9m',
    'refresher_12m',
    'quiz_prompt'
  ));

COMMENT ON COLUMN da_email_sequences.template_key IS
  'Email template identifier (migration 044). Canonical set = Kartra post-course journey + transactional (incl. course_updated and product_purchase_confirmation) + billing keys; legacy interval keys retained. send-emails renders the matching template from supabase/functions/send-emails/templates.ts.';
