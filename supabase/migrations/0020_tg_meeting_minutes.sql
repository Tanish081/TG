-- ============================================================================
-- Adds Minutes of Meeting (MoM) alongside the agenda on tg_meetings —
-- agenda is what was planned, minutes are what was actually discussed and
-- decided. Nullable since existing meetings won't have one yet.
--
-- Safe to run more than once.
-- ============================================================================

alter table tg_meetings add column if not exists minutes text;
