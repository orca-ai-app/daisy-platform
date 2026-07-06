-- 032_email_broadcasts.sql
-- One-off broadcast emails composed in the HQ block builder: audiences
-- (opted-in customers, per-franchisee customers, franchisees, CSV lists),
-- send-now/scheduled, per-recipient delivery/open tracking, and a GLOBAL
-- email suppression table that every marketing send path checks.
--
-- This is migration 033 — do NOT renumber.

-- da_email_lists / da_email_list_members --------------------------------------
-- Custom audiences built in the portal (CSV upload or manual add).

CREATE TABLE da_email_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID REFERENCES da_franchisees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_email_lists_updated_at
  BEFORE UPDATE ON da_email_lists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE da_email_list_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES da_email_lists(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_list_members_unique_email ON da_email_list_members (list_id, lower(email));

-- da_email_suppressions --------------------------------------------------------
-- THE single global marketing opt-out check. Rows come from unsubscribe links
-- (customers and list members), Postmark spam complaints, or manual HQ adds.
-- Emails are stored lowercased. da_customers.marketing_opt_out remains as the
-- per-customer UI flag; this table is what send paths consult.

CREATE TABLE da_email_suppressions (
  email TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('unsubscribe', 'spam_complaint', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO da_email_suppressions (email, source)
SELECT lower(email), 'unsubscribe'
FROM da_customers
WHERE marketing_opt_out
ON CONFLICT (email) DO NOTHING;

-- da_email_broadcasts ----------------------------------------------------------

CREATE TABLE da_email_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  preheader TEXT,
  blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  audience_type TEXT NOT NULL CHECK (audience_type IN (
    'customers_all',        -- every opted-in customer (broadcasts stream)
    'customers_franchisee', -- opted-in customers of audience_config.franchisee_ids (broadcasts stream)
    'franchisees_all',      -- every active franchisee (outbound stream, no unsubscribe)
    'franchisees_selected', -- audience_config.franchisee_ids (outbound stream, no unsubscribe)
    'list'                  -- audience_config.list_id members (broadcasts stream)
  )),
  audience_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_by UUID REFERENCES da_franchisees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_email_broadcasts_updated_at
  BEFORE UPDATE ON da_email_broadcasts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_email_broadcasts_due ON da_email_broadcasts (status, scheduled_for);

-- da_email_broadcast_recipients -------------------------------------------------
-- Materialised at send time by _shared/broadcastSender.ts. Only 'pending' rows
-- are ever sent, so a crashed run resumes safely.

CREATE TABLE da_email_broadcast_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES da_email_broadcasts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  customer_id UUID REFERENCES da_customers(id) ON DELETE SET NULL,
  franchisee_id UUID REFERENCES da_franchisees(id) ON DELETE SET NULL,
  list_member_id UUID REFERENCES da_email_list_members(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  provider_message_id TEXT,
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_broadcast_recipients_unique ON da_email_broadcast_recipients (broadcast_id, email);
CREATE INDEX idx_broadcast_recipients_status ON da_email_broadcast_recipients (broadcast_id, status);

-- da_email_events: correlate broadcast sends ------------------------------------

ALTER TABLE da_email_events
  ADD COLUMN broadcast_recipient_id UUID REFERENCES da_email_broadcast_recipients(id) ON DELETE CASCADE;

CREATE INDEX idx_email_events_broadcast_recipient ON da_email_events (broadcast_recipient_id);

-- RLS ----------------------------------------------------------------------------
-- HQ-only surface; the sender/webhook functions write with the service role.

ALTER TABLE da_email_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hq_full_access" ON da_email_lists FOR ALL USING (is_hq_user());

ALTER TABLE da_email_list_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hq_full_access" ON da_email_list_members FOR ALL USING (is_hq_user());

ALTER TABLE da_email_suppressions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hq_full_access" ON da_email_suppressions FOR ALL USING (is_hq_user());

ALTER TABLE da_email_broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hq_full_access" ON da_email_broadcasts FOR ALL USING (is_hq_user());

ALTER TABLE da_email_broadcast_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hq_full_access" ON da_email_broadcast_recipients FOR ALL USING (is_hq_user());
