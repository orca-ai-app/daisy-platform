-- 054: non-sensitive "speak to the attendee" indicator (Lucy, 8 Sep).
--
-- Health answers stay encrypted and HQ-only. What the trainer running the
-- class DOES get: photo consent (already a plain column) and this boolean —
-- computed server-side at submission from "any condition ticked other than
-- 'none', or special requirements answered yes". It reveals THAT there is
-- something to ask about, never what. NULL = submitted before this shipped.
ALTER TABLE da_medical_declarations ADD COLUMN IF NOT EXISTS medical_flagged boolean;
