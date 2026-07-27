-- ============================================================================
-- Fix roll_code part order to Year-Branch-AcademicYear-Number
-- (was Year-AcademicYear-Branch-Number in 0001_schema.sql).
--
-- e.g. SE, AID, 2025-26, roll 12 -> "SEAID252612" (was "SE2526AID12").
--
-- Generated columns can't have their expression altered in place, so this
-- drops and re-adds it — safe, since it's always recomputed from the other
-- columns and never written to directly.
-- ============================================================================

alter table student_enrollments drop column roll_code;

alter table student_enrollments add column roll_code text generated always as (
  year_level || branch_code || ay_short(academic_year) || roll_seq::text
) stored;
