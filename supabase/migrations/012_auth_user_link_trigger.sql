-- 012_auth_user_link_trigger.sql
-- Auto-links a newly created auth.users row to a pre-provisioned da_franchisees
-- row by case-insensitive email match. Fires for any auth method (Google SSO,
-- magic link, email + password). Idempotent: only updates rows where
-- auth_user_id IS NULL, so existing links are preserved.
--
-- This is the bridge that lets HQ bulk-onboard franchisee data into da_franchisees
-- (with auth_user_id = NULL), then have those rows auto-link the first time the
-- franchisee signs in via Google with a matching email address.
--
-- See docs/M1-build-plan.md §3 (architecture decisions) — Google SSO became the
-- primary auth method on 2026-04-30, replacing magic links.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.da_franchisees
  SET auth_user_id = NEW.id,
      updated_at = NOW()
  WHERE LOWER(email) = LOWER(NEW.email)
    AND auth_user_id IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- Also handle email changes on auth.users (e.g. franchisee swaps Google account).
-- Re-link if the new email matches a different unprovisioned da_franchisees row.
CREATE OR REPLACE FUNCTION public.handle_auth_user_email_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.da_franchisees
    SET auth_user_id = NEW.id,
        updated_at = NOW()
    WHERE LOWER(email) = LOWER(NEW.email)
      AND auth_user_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_change ON auth.users;
CREATE TRIGGER on_auth_user_email_change
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auth_user_email_change();
