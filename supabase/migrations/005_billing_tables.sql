-- 005_billing_tables.sql
-- da_discount_codes, da_billing_runs, da_email_sequences
-- Reference: docs/PRD-technical.md §4.12 — §4.14
--
-- Note: The M1 plan §5 lists this migration as "da_billing_runs, da_email_sequences"
-- and does not name da_discount_codes. The PRD has 15 tables across §4.2 — §4.16,
-- so da_discount_codes (§4.12) lives here — the most logical adjacent grouping —
-- so all 15 tables ship in Wave 1 as the plan otherwise demands.

-- da_discount_codes -----------------------------------------------------------

CREATE TABLE da_discount_codes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  franchisee_id  UUID REFERENCES da_franchisees(id),
  code           TEXT NOT NULL UNIQUE,
  type           TEXT NOT NULL CHECK (type IN ('percentage', 'fixed')),
  value          INTEGER NOT NULL CHECK (value >= 0),
  max_uses       INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  uses_count     INTEGER DEFAULT 0 CHECK (uses_count >= 0),
  valid_from     TIMESTAMPTZ,
  valid_until    TIMESTAMPTZ,
  is_active      BOOLEAN DEFAULT TRUE,
  CHECK (type <> 'percentage' OR value BETWEEN 0 AND 100)
);

COMMENT ON TABLE  da_discount_codes IS 'Discount codes — network-wide if franchisee_id NULL, otherwise scoped.';
COMMENT ON COLUMN da_discount_codes.value IS 'Percentage 0-100 (when type=percentage) or pence (when type=fixed).';

-- da_billing_runs -------------------------------------------------------------

CREATE TABLE da_billing_runs (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  franchisee_id               UUID NOT NULL REFERENCES da_franchisees(id),
  billing_period_start        DATE NOT NULL,
  billing_period_end          DATE NOT NULL,
  territory_breakdown         JSONB NOT NULL,
  total_base_fees_pence       INTEGER NOT NULL CHECK (total_base_fees_pence >= 0),
  total_percentage_fees_pence INTEGER NOT NULL CHECK (total_percentage_fees_pence >= 0),
  total_due_pence             INTEGER NOT NULL CHECK (total_due_pence >= 0),
  gocardless_payment_id       TEXT,
  payment_status              TEXT NOT NULL DEFAULT 'pending'
                              CHECK (payment_status IN ('pending', 'sent', 'paid', 'failed', 'retry')),
  retry_count                 INTEGER DEFAULT 0 CHECK (retry_count >= 0),
  paid_at                     TIMESTAMPTZ,
  notes                       TEXT,
  CHECK (billing_period_end >= billing_period_start)
);

COMMENT ON TABLE da_billing_runs IS 'Monthly franchisee fee invoices. Records the MAX(base, 10%) per-territory math.';

-- da_email_sequences ----------------------------------------------------------
-- No updated_at per PRD §4.14 — these rows mutate only on send (status, sent_at).

CREATE TABLE da_email_sequences (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  customer_id    UUID NOT NULL REFERENCES da_customers(id),
  booking_id     UUID NOT NULL REFERENCES da_bookings(id),
  template_key   TEXT NOT NULL,
  sequence_day   INTEGER NOT NULL,
  scheduled_for  TIMESTAMPTZ NOT NULL,
  sent_at        TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'sent', 'failed', 'cancelled'))
);

COMMENT ON TABLE da_email_sequences IS 'Scheduled refresher emails — populated post-event, drained by send-emails cron.';
