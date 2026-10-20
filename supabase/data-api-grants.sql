-- Run after EVERY migration on the Daisy project (dmvajkreuwknjqxyxmlv). Not a
-- numbered migration, so it is re-run each time.
--
-- From 2026-10-30 Supabase no longer grants Data API access to new tables in
-- "public" automatically. A table created by a migration after that date would
-- answer "permission denied" through supabase-js / PostgREST until granted.
-- This restates the grants existing tables already have. RLS stays the access
-- control; the final SELECT lists any public table without RLS (PostGIS's
-- spatial_ref_sys is expected and harmless). Idempotent.

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

select 'WARN no RLS: public.' || c.relname as warning
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  and c.relname <> 'spatial_ref_sys';
