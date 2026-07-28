-- ============================================================================
-- Fix: students_select_class_teacher_broad (0006) granted every class
-- teacher SELECT on the entire `students` table — every division's names,
-- PRNs, emails, and phone numbers, not just their own. That migration's own
-- comment documented it as a deliberate trade-off to satisfy Postgres's
-- requirement that a freshly-INSERTed row also pass a SELECT policy for
-- `INSERT ... RETURNING` to work (a brand-new student has no enrollment yet
-- for the properly-scoped students_select_class_teacher policy to match).
--
-- With real student data this is a real privacy hole, not just a shortcut.
-- Fix: scope it to "students I just created that aren't enrolled yet" via a
-- new created_by column. The moment the student gets an enrollment, this
-- policy stops matching and students_select_class_teacher (scoped by actual
-- division) takes over — same fix, much narrower window.
--
-- Safe to run more than once.
-- ============================================================================

alter table students add column if not exists created_by uuid references teachers (id);

drop policy if exists students_select_class_teacher_broad on students;
drop policy if exists students_select_class_teacher_own_new on students;

create policy students_select_class_teacher_own_new on students
  for select to authenticated
  using (
    created_by = auth.uid()
    and not exists (select 1 from student_enrollments se where se.student_id = students.id)
  );

drop policy if exists students_insert_class_teacher on students;

create policy students_insert_class_teacher on students
  for insert to authenticated
  with check (is_class_teacher() and created_by = auth.uid());
