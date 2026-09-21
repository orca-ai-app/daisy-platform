-- 060: mini-HQ CRM — email a hand-picked set of contacts, and record where a
-- contact came from.
--
-- The broadcast system (migration 033) can already email every opted-in
-- customer, customers of chosen franchisees, or a saved list. HQ now also wants
-- to browse the contact directory and email a specific ticked selection
-- ("email all, or some") — Jenni, 16 Sep 2026. That's a new audience type,
-- 'customers_selected', whose audience_config carries { customer_ids: [...] }.
-- broadcastSender loads those customers (opt-out filtered) and the normal
-- suppression + unsubscribe handling applies, exactly like customers_all.
--
-- Also adds da_customers.source so the Kartra seed import is distinguishable
-- from contacts that grew from real bookings (provenance for GDPR/auditing).

-- 1. Allow the new audience type on broadcasts.
ALTER TABLE da_email_broadcasts
  DROP CONSTRAINT IF EXISTS da_email_broadcasts_audience_type_check;

ALTER TABLE da_email_broadcasts
  ADD CONSTRAINT da_email_broadcasts_audience_type_check CHECK (audience_type IN (
    'customers_all',        -- every opted-in customer (broadcasts stream)
    'customers_selected',   -- opted-in customers in audience_config.customer_ids (broadcasts stream)
    'customers_franchisee', -- opted-in customers of audience_config.franchisee_ids (broadcasts stream)
    'franchisees_all',      -- every active franchisee (outbound stream, no unsubscribe)
    'franchisees_selected', -- audience_config.franchisee_ids (outbound stream, no unsubscribe)
    'list'                  -- audience_config.list_id members (broadcasts stream)
  ));

-- 2. Where a contact came from. NULL for pre-existing rows (all booking-grown);
--    the Kartra import stamps e.g. 'kartra_2026-09-17', future sources their own.
ALTER TABLE da_customers
  ADD COLUMN IF NOT EXISTS source TEXT;

COMMENT ON COLUMN da_customers.source IS
  'Provenance of the contact: NULL/''booking'' when created from a booking, or an import tag like ''kartra_2026-09-17'' for a seeded contact (migration 060).';
