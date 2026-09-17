-- 057: email delivery health snapshots.
--
-- Born from the 15-16 Sep Postmark incident: the provider accepted 47 emails
-- with success codes and silently discarded them for ~30h. Rows said 'sent',
-- nothing failed loudly, a franchisee noticed before we did. Each hourly
-- send-emails run now writes one snapshot here comparing what we marked sent
-- against the delivery events Postmark's webhook actually returned. Consumed
-- by the HQ Platform health strip, the orca-badge stats fn, and the Pushover
-- escalation inside send-emails.

CREATE TABLE da_email_health (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- green: delivery confirmed. amber: 1-2 unconfirmed (could be webhook lag)
  -- or elevated bounces. red: >=3 sends unconfirmed >2h, or failures present.
  state         TEXT NOT NULL CHECK (state IN ('green', 'amber', 'red')),
  unconfirmed_count INTEGER NOT NULL DEFAULT 0,
  failed_24h    INTEGER NOT NULL DEFAULT 0,
  bounce_rate_7d NUMERIC(5,2) NOT NULL DEFAULT 0,
  last_delivery_at TIMESTAMPTZ,
  -- true on the snapshot that fired (or re-fired) the Pushover escalation.
  alert_sent    BOOLEAN NOT NULL DEFAULT false,
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_email_health_checked ON da_email_health (checked_at DESC);

ALTER TABLE da_email_health ENABLE ROW LEVEL SECURITY;

-- HQ reads it on the dashboard; nothing client-side ever writes it.
CREATE POLICY email_health_hq_read ON da_email_health
  FOR SELECT USING (is_hq_user());

-- 60-day retention, swept by the same run that inserts (no separate cron).
