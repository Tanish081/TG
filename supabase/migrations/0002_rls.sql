-- ============================================================================
-- Teacher Guardian (TG) — RLS policies (§12)
-- All "own X" checks resolve against auth.uid() (the teacher's profile id).
--
-- Bulk/sensitive writes (roster upload, promotion/YD renumbering) are done
-- through Edge Functions with the service-role key, per §1 ("Optional server
-- logic ... for work that should not run on the client — e.g. bulk promotion,
-- mark uploads with service-role access"). Service-role bypasses RLS, so those
-- flows are authorized in the function itself, not via these policies.
-- Direct client writes below cover the single-row, same-teacher-scope actions
-- (marking attendance, correcting a roll number, entering one result, etc).
-- ============================================================================

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ----------------------------------------------------------------------------
-- Helper functions (security definer: they read tables that themselves have
-- RLS enabled, so they must bypass RLS to avoid infinite recursion when used
-- inside a policy).
-- ----------------------------------------------------------------------------

create function is_dept_coordinator()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from teachers where id = auth.uid() and is_dept_coordinator)
$$;

-- Read-only department-wide statistics role — see teachers table comment
-- in 0001_schema.sql. No write policy anywhere references this function.
create function is_hod()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from teachers where id = auth.uid() and is_hod)
$$;

create function is_tg()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from batches where tg_teacher_id = auth.uid())
$$;

create function is_class_teacher_of_division_parts(
  p_academic_year text, p_year_level text, p_branch_code text, p_division text
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from divisions
    where academic_year = p_academic_year
      and year_level = p_year_level
      and branch_code = p_branch_code
      and division = p_division
      and class_teacher_id = auth.uid()
  )
$$;

create function is_class_teacher_of_enrollment(p_enrollment_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from student_enrollments se
    join divisions d
      on d.academic_year = se.academic_year
     and d.year_level = se.year_level
     and d.branch_code = se.branch_code
     and d.division = se.division
    where se.id = p_enrollment_id
      and d.class_teacher_id = auth.uid()
  )
$$;

create function is_tg_of_enrollment(p_enrollment_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from student_enrollments se
    join batches b
      on b.academic_year = se.academic_year
     and b.year_level = se.year_level
     and b.branch_code = se.branch_code
     and b.division = se.division
    where se.id = p_enrollment_id
      and b.tg_teacher_id = auth.uid()
      and se.roll_seq between b.roll_start and b.roll_end
  )
$$;

create function teaches_cohort(p_cohort_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from teaching_assignments
    where cohort_id = p_cohort_id and teacher_id = auth.uid()
  )
$$;

create function reads_enrollment_via_cohort(p_enrollment_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from cohort_members cm
    join teaching_assignments ta on ta.cohort_id = cm.cohort_id
    where cm.enrollment_id = p_enrollment_id and ta.teacher_id = auth.uid()
  )
$$;

-- `students` has no division column (identity is division-agnostic — §3), so
-- "is a class teacher of something" is the narrowest check available for
-- letting a class teacher create/read a student identity before any
-- enrollment ties it to their specific division.
create function is_class_teacher()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from divisions where class_teacher_id = auth.uid())
$$;

-- ----------------------------------------------------------------------------
-- teachers
-- ----------------------------------------------------------------------------
alter table teachers enable row level security;

create policy teachers_select on teachers
  for select to authenticated
  using (is_dept_coordinator() or id = auth.uid());

create policy teachers_write_hod on teachers
  for update to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

create policy teachers_delete_hod on teachers
  for delete to authenticated
  using (is_dept_coordinator());

-- ----------------------------------------------------------------------------
-- students
-- ----------------------------------------------------------------------------
alter table students enable row level security;

create policy students_full_hod on students
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

create policy students_select_class_teacher on students
  for select to authenticated
  using (exists (
    select 1 from student_enrollments se
    where se.student_id = students.id and is_class_teacher_of_enrollment(se.id)
  ));

-- Lets a class teacher create a new student identity (e.g. onboarding an
-- incoming division) and read it straight back — Postgres requires the
-- freshly-inserted row to also pass a SELECT policy for `INSERT ... RETURNING`
-- to work, and a brand-new student has no enrollment yet for the policy
-- above to match. `created_by` must be their own id, both so the read-back
-- policy below actually matches and so one class teacher can't backdate
-- rows as if another teacher created them.
create policy students_insert_class_teacher on students
  for insert to authenticated
  with check (is_class_teacher() and created_by = auth.uid());

-- Scoped to "students I just created that aren't enrolled yet" — not a
-- blanket "is a class teacher of something" grant. A brand-new student has
-- no enrollment for students_select_class_teacher (below) to key off yet,
-- so this covers only that gap; once enrolled, that policy takes over and
-- this one no longer matches (the row now has an enrollment).
create policy students_select_class_teacher_own_new on students
  for select to authenticated
  using (
    created_by = auth.uid()
    and not exists (select 1 from student_enrollments se where se.student_id = students.id)
  );

-- Scoped to students they personally created (same idea as the insert/
-- select-own-new policies above) — a class teacher can undo their own
-- mistakes but can't delete a student another teacher owns, even one
-- currently enrolled in their division. Deleting cascades to that
-- student's enrollments, attendance, assessments, everything.
create policy students_delete_class_teacher_own on students
  for delete to authenticated
  using (created_by = auth.uid());

create policy students_select_tg on students
  for select to authenticated
  using (exists (
    select 1 from student_enrollments se
    where se.student_id = students.id and is_tg_of_enrollment(se.id)
  ));

create policy students_select_subject_teacher on students
  for select to authenticated
  using (exists (
    select 1 from student_enrollments se
    where se.student_id = students.id and reads_enrollment_via_cohort(se.id)
  ));

create policy students_select_hod on students
  for select to authenticated
  using (is_hod());

-- ----------------------------------------------------------------------------
-- student_enrollments
-- ----------------------------------------------------------------------------
alter table student_enrollments enable row level security;

create policy enrollments_full_hod on student_enrollments
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

create policy enrollments_select_class_teacher on student_enrollments
  for select to authenticated
  using (is_class_teacher_of_enrollment(id));

create policy enrollments_insert_class_teacher on student_enrollments
  for insert to authenticated
  with check (is_class_teacher_of_division_parts(academic_year, year_level, branch_code, division));

create policy enrollments_update_class_teacher on student_enrollments
  for update to authenticated
  using (is_class_teacher_of_enrollment(id))
  with check (is_class_teacher_of_division_parts(academic_year, year_level, branch_code, division));

create policy enrollments_select_tg on student_enrollments
  for select to authenticated
  using (is_tg_of_enrollment(id));

create policy enrollments_select_subject_teacher on student_enrollments
  for select to authenticated
  using (reads_enrollment_via_cohort(id));

-- ----------------------------------------------------------------------------
-- divisions
-- ----------------------------------------------------------------------------
alter table divisions enable row level security;

create policy divisions_full_hod on divisions
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

create policy divisions_select_all on divisions
  for select to authenticated
  using (true);

-- ----------------------------------------------------------------------------
-- subjects
-- ----------------------------------------------------------------------------
alter table subjects enable row level security;

create policy subjects_full_hod on subjects
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

create policy subjects_select_all on subjects
  for select to authenticated
  using (true);

-- ----------------------------------------------------------------------------
-- batches
-- ----------------------------------------------------------------------------
alter table batches enable row level security;

create policy batches_full_hod on batches
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

create policy batches_select_class_teacher on batches
  for select to authenticated
  using (is_class_teacher_of_division_parts(academic_year, year_level, branch_code, division));

create policy batches_select_tg on batches
  for select to authenticated
  using (tg_teacher_id = auth.uid());

-- ----------------------------------------------------------------------------
-- cohorts
-- ----------------------------------------------------------------------------
alter table cohorts enable row level security;

create policy cohorts_full_hod on cohorts
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

create policy cohorts_select_class_teacher on cohorts
  for select to authenticated
  using (exists (
    select 1 from cohort_members cm
    where cm.cohort_id = cohorts.id and is_class_teacher_of_enrollment(cm.enrollment_id)
  ));

-- Electives start with zero members (each class teacher opts their own
-- students in from "My division") — the policy above can never match a
-- brand-new elective, since it requires an existing member to key off.
-- Electives aren't scoped to one division by design, so any class teacher
-- can see all of them, full stop, rather than trying to scope by membership.
create policy cohorts_select_elective_class_teacher on cohorts
  for select to authenticated
  using (type = 'elective' and is_class_teacher());

create policy cohorts_select_tg on cohorts
  for select to authenticated
  using (exists (
    select 1 from cohort_members cm
    where cm.cohort_id = cohorts.id and is_tg_of_enrollment(cm.enrollment_id)
  ));

create policy cohorts_select_subject_teacher on cohorts
  for select to authenticated
  using (teaches_cohort(id));

-- ----------------------------------------------------------------------------
-- cohort_members
-- ----------------------------------------------------------------------------
alter table cohort_members enable row level security;

create policy cohort_members_full_hod on cohort_members
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

create policy cohort_members_insert_class_teacher on cohort_members
  for insert to authenticated
  with check (is_class_teacher_of_enrollment(enrollment_id));

create policy cohort_members_delete_class_teacher on cohort_members
  for delete to authenticated
  using (is_class_teacher_of_enrollment(enrollment_id));

create policy cohort_members_select_class_teacher on cohort_members
  for select to authenticated
  using (is_class_teacher_of_enrollment(enrollment_id));

create policy cohort_members_select_tg on cohort_members
  for select to authenticated
  using (is_tg_of_enrollment(enrollment_id));

create policy cohort_members_select_subject_teacher on cohort_members
  for select to authenticated
  using (teaches_cohort(cohort_id));

-- ----------------------------------------------------------------------------
-- teaching_assignments
-- ----------------------------------------------------------------------------
alter table teaching_assignments enable row level security;

create policy teaching_assignments_full_hod on teaching_assignments
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

create policy teaching_assignments_select_self on teaching_assignments
  for select to authenticated
  using (teacher_id = auth.uid());

-- ----------------------------------------------------------------------------
-- attendance_sessions
-- ----------------------------------------------------------------------------
alter table attendance_sessions enable row level security;

create policy attendance_sessions_full_hod on attendance_sessions
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

create policy attendance_sessions_select_class_teacher on attendance_sessions
  for select to authenticated
  using (exists (
    select 1 from cohort_members cm
    where cm.cohort_id = attendance_sessions.cohort_id
      and is_class_teacher_of_enrollment(cm.enrollment_id)
  ));

create policy attendance_sessions_select_tg on attendance_sessions
  for select to authenticated
  using (exists (
    select 1 from cohort_members cm
    where cm.cohort_id = attendance_sessions.cohort_id
      and is_tg_of_enrollment(cm.enrollment_id)
  ));

create policy attendance_sessions_insert_subject_teacher on attendance_sessions
  for insert to authenticated
  with check (teacher_id = auth.uid() and teaches_cohort(cohort_id));

create policy attendance_sessions_select_subject_teacher on attendance_sessions
  for select to authenticated
  using (teaches_cohort(cohort_id));

-- ----------------------------------------------------------------------------
-- attendance_records
-- ----------------------------------------------------------------------------
alter table attendance_records enable row level security;

create policy attendance_records_full_hod on attendance_records
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

create policy attendance_records_select_class_teacher on attendance_records
  for select to authenticated
  using (is_class_teacher_of_enrollment(enrollment_id));

create policy attendance_records_select_tg on attendance_records
  for select to authenticated
  using (is_tg_of_enrollment(enrollment_id));

create policy attendance_records_write_subject_teacher on attendance_records
  for insert to authenticated
  with check (exists (
    select 1 from attendance_sessions s
    where s.id = attendance_records.session_id and teaches_cohort(s.cohort_id)
  ));

create policy attendance_records_update_subject_teacher on attendance_records
  for update to authenticated
  using (exists (
    select 1 from attendance_sessions s
    where s.id = attendance_records.session_id and teaches_cohort(s.cohort_id)
  ))
  with check (exists (
    select 1 from attendance_sessions s
    where s.id = attendance_records.session_id and teaches_cohort(s.cohort_id)
  ));

create policy attendance_records_select_subject_teacher on attendance_records
  for select to authenticated
  using (exists (
    select 1 from attendance_sessions s
    where s.id = attendance_records.session_id and teaches_cohort(s.cohort_id)
  ));

-- ----------------------------------------------------------------------------
-- assessments
-- ----------------------------------------------------------------------------
alter table assessments enable row level security;

create policy assessments_full_hod on assessments
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

create policy assessments_select_all on assessments
  for select to authenticated
  using (true);

create policy assessments_write_tg on assessments
  for insert to authenticated
  with check (is_tg());

-- ----------------------------------------------------------------------------
-- assessment_results
-- ----------------------------------------------------------------------------
alter table assessment_results enable row level security;

create policy assessment_results_full_hod on assessment_results
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

create policy assessment_results_select_class_teacher on assessment_results
  for select to authenticated
  using (is_class_teacher_of_enrollment(enrollment_id));

create policy assessment_results_full_tg on assessment_results
  for all to authenticated
  using (is_tg_of_enrollment(enrollment_id))
  with check (is_tg_of_enrollment(enrollment_id));

-- ----------------------------------------------------------------------------
-- semester_results
-- ----------------------------------------------------------------------------
alter table semester_results enable row level security;

create policy semester_results_full_hod on semester_results
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

create policy semester_results_select_class_teacher on semester_results
  for select to authenticated
  using (is_class_teacher_of_enrollment(enrollment_id));

create policy semester_results_full_tg on semester_results
  for all to authenticated
  using (is_tg_of_enrollment(enrollment_id))
  with check (is_tg_of_enrollment(enrollment_id));

-- ----------------------------------------------------------------------------
-- HOD (read-only department-wide statistics). SELECT only, everywhere — this
-- role structurally cannot manipulate data since no write policy anywhere
-- references is_hod(). `divisions` and `subjects` already have an open
-- `using (true)` select policy for all authenticated teachers, so they need
-- no additional policy here.
-- ----------------------------------------------------------------------------

create policy teachers_select_hod on teachers
  for select to authenticated
  using (is_hod());

create policy batches_select_hod on batches
  for select to authenticated
  using (is_hod());

create policy enrollments_select_hod on student_enrollments
  for select to authenticated
  using (is_hod());

create policy attendance_sessions_select_hod on attendance_sessions
  for select to authenticated
  using (is_hod());

create policy attendance_records_select_hod on attendance_records
  for select to authenticated
  using (is_hod());

create policy assessment_results_select_hod on assessment_results
  for select to authenticated
  using (is_hod());

create policy semester_results_select_hod on semester_results
  for select to authenticated
  using (is_hod());
