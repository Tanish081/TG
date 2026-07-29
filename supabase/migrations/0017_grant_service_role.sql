-- ============================================================================
-- Fix: "permission denied for table teachers" from the invite-teacher edge
-- function's set-email action, using the service-role client.
--
-- 0002_rls.sql granted table access to `authenticated` but never explicitly
-- to `service_role`. Bypassing RLS (service_role's default behavior) and
-- having the base SQL grant to actually touch a table are two separate
-- things in Postgres — every other service-role write in this app went
-- through Supabase's Admin API (auth.admin.inviteUserByEmail,
-- auth.admin.deleteUser), which operates on the auth schema directly and
-- never hit this gap. set-email's plain `.from("teachers").update(...)` as
-- service_role was the first thing to actually need this grant.
--
-- Safe to run more than once.
-- ============================================================================

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
