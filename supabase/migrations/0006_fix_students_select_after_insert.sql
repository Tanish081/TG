-- ============================================================================
-- Fix: class teachers can INSERT new students (0005) but the app's
-- `.insert(...).select("id, prn")` call needs the freshly-created row to also
-- pass a SELECT policy — Postgres requires this for INSERT ... RETURNING.
-- A brand-new student has no enrollment yet, so none of the existing SELECT
-- policies (which all key off student_enrollments) match it, and Postgres
-- reports that as "new row violates row-level security policy" — identical
-- wording to an INSERT rejection, which is why it looked like the same bug.
--
-- Mirrors the same trade-off already accepted for the INSERT policy (0003):
-- scoped to "is a class teacher of something", not "own division", because
-- `students` has no division column to scope by.
--
-- Safe to run more than once.
-- ============================================================================

drop policy if exists students_select_class_teacher_broad on students;

create policy students_select_class_teacher_broad on students
  for select to authenticated
  using (is_class_teacher());
