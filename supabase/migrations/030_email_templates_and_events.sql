-- 030_email_templates_and_events.sql
-- Kartra migration: HQ-editable email templates, open/delivery tracking, and
-- marketing unsubscribe. docs/M3-email-journey.md is the canonical journey;
-- the send-emails function renders da_email_templates rows (blocks JSONB) and
-- falls back to code templates (templates.ts) for keys without a row.
--
-- This is migration 030 — do NOT renumber.

-- da_email_templates ----------------------------------------------------------
-- One row per HQ-editable email. `blocks` is an ordered JSONB array of typed
-- blocks (heading | paragraph | image | button | list | divider) rendered by
-- supabase/functions/_shared/emailBlocks.ts. Paragraph/list text supports a
-- markdown subset (**bold**, *italic*, [label](url)) and {{merge}} fields.

CREATE TABLE da_email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  preheader TEXT,
  blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Marketing emails respect da_customers.marketing_opt_out; transactional
  -- (booking confirmation, medical reminder, franchisee notification) do not.
  is_marketing BOOLEAN NOT NULL DEFAULT true,
  -- Journey display metadata (send offsets live in stripe-webhook, not here).
  sort_order INTEGER NOT NULL DEFAULT 0,
  delay_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES da_franchisees(id)
);

CREATE TRIGGER trg_email_templates_updated_at
  BEFORE UPDATE ON da_email_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE da_email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_full_access" ON da_email_templates
  FOR ALL USING (is_hq_user());

-- da_email_events -------------------------------------------------------------
-- Postmark webhook events (delivery / open / bounce / spam complaint), keyed
-- back to the queue row via Metadata.sequence_id set at send time. Written by
-- the postmark-webhook function (service role); HQ reads for analytics.

CREATE TABLE da_email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID REFERENCES da_email_sequences(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('delivered', 'opened', 'bounced', 'spam_complaint')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB
);

CREATE INDEX idx_email_events_template_key ON da_email_events (template_key, event_type, occurred_at);
CREATE INDEX idx_email_events_sequence_id ON da_email_events (sequence_id);

ALTER TABLE da_email_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_read" ON da_email_events
  FOR SELECT USING (is_hq_user());

-- da_email_sequences: provider correlation + first-open ------------------------

ALTER TABLE da_email_sequences
  ADD COLUMN provider_message_id TEXT,
  ADD COLUMN opened_at TIMESTAMPTZ;

COMMENT ON COLUMN da_email_sequences.provider_message_id IS
  'Postmark MessageID returned at send time (migration 030). Correlates webhook events.';
COMMENT ON COLUMN da_email_sequences.opened_at IS
  'First Postmark Open event for this send (migration 030). Set by postmark-webhook.';

-- da_customers: marketing unsubscribe ------------------------------------------

ALTER TABLE da_customers
  ADD COLUMN marketing_opt_out BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN marketing_opt_out_at TIMESTAMPTZ;

COMMENT ON COLUMN da_customers.marketing_opt_out IS
  'True = customer unsubscribed from marketing emails (migration 030). Transactional emails still send. Set by the unsubscribe function; also set on Postmark spam complaints.';

-- email-assets storage bucket ---------------------------------------------------
-- Public-read media library for email images (HQ uploads via the portal).

INSERT INTO storage.buckets (id, name, public)
VALUES ('email-assets', 'email-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "email_assets_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'email-assets');

CREATE POLICY "email_assets_hq_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'email-assets' AND is_hq_user());

CREATE POLICY "email_assets_hq_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'email-assets' AND is_hq_user());

CREATE POLICY "email_assets_hq_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'email-assets' AND is_hq_user());
