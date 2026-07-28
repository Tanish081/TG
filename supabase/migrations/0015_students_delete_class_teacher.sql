-- ============================================================================
-- Lets a class teacher delete a student they personally created (scoped via
-- created_by, added in 0014) — e.g. undoing a wrong entry from a roster
-- import. They can't delete a student another teacher owns, even one
-- currently enrolled in their division. Deleting cascades to that student's
-- enrollments, attendance, assessments, and semester results (all FK'd with
-- `on delete cascade`).
--
-- Dept Coordinators already have full delete via students_full_hod —
-- unaffected by this migration.
--
-- Safe to run more than once.
-- ============================================================================

drop policy if exists students_delete_class_teacher_own on students;

create policy students_delete_class_teacher_own on students
  for delete to authenticated
  using (created_by = auth.uid());
