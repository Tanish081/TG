-- ============================================================================
-- Fix: the read-only HOD role (0010) got a SELECT policy on every table it
-- needs *except* `students` itself — so joining student_enrollments to
-- students(name) for the low-attendance drill-down silently came back empty
-- (RLS blocks the embedded row, which PostgREST just omits rather than
-- erroring on).
--
-- Safe to run more than once.
-- ============================================================================

create policy students_select_hod on students
  for select to authenticated
  using (is_hod());
