-- 034_hq_notification_email.sql
-- Where new-enquiry (interest form) notification emails are sent.
-- Read by process-interest-form at submit time; stored in da_settings so HQ
-- can change the recipient without a redeploy.
--
-- NOTE: while the Postmark account is in TEST MODE (pre-approval), sends only
-- reach confirmed sender-signature addresses — jenni@ will be accepted by our
-- code but rejected by Postmark until account approval (cutover checklist).
--
-- This is migration 034 — do NOT renumber.

INSERT INTO da_settings (key, value, description)
VALUES (
  'hq_notification_email',
  'jenni@daisyfirstaid.com',
  'Recipient for new-enquiry (interest form) notification emails.'
)
ON CONFLICT (key) DO NOTHING;
