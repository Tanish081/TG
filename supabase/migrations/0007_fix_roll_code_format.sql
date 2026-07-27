-- ============================================================================
-- Fix roll_code format to Year-Branch-AcademicYear-Division-Number, with the
-- number zero-padded to 3 digits.
--
-- e.g. SE, AID, 2026-27, division C, roll 33 -> "SEAID2627C033"
-- (was "SEAID262733" — no division letter, no zero-padding).
--
-- Safe to run more than once.
-- ============================================================================

alter table student_enrollments drop column if exists roll_code;

alter table student_enrollments add column roll_code text generated always as (
  year_level || branch_code || ay_short(academic_year) || division || lpad(roll_seq::text, 3, '0')
) stored;
