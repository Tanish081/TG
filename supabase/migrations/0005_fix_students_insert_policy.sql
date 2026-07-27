-- ============================================================================
-- Fix: students_insert_class_teacher used a raw subquery against `divisions`,
-- which depends on divisions' own RLS policies being visible to the caller
-- inside a nested EXISTS check. Every other cross-table permission check in
-- this schema (is_tg_of_enrollment, teaches_cohort, etc.) instead uses a
-- SECURITY DEFINER function, which reads the underlying data directly and
-- sidesteps that dependency entirely. Bringing this one in line fixes it.
--
-- Safe to run more than once.
-- ============================================================================

drop policy if exists students_insert_class_teacher on students;
drop function if exists is_class_teacher();

create function is_class_teacher()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from divisions where class_teacher_id = auth.uid())
$$;

create policy students_insert_class_teacher on students
  for insert to authenticated
  with check (is_class_teacher());
