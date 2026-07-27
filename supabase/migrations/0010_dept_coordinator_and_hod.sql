-- ============================================================================
-- Split the old single "HOD" role into two:
--
--   - Dept Coordinator: everything the old HOD could do (full manage access).
--     This is a rename, not a new role — `is_hod` becomes `is_dept_coordinator`.
--   - HOD: brand new role. Read-only department-wide statistics — attendance,
--     GPA, batch/division health. Cannot create, edit, or delete anything.
--
-- The security-definer function `is_hod()` is renamed to `is_dept_coordinator()`
-- via ALTER FUNCTION, which preserves its OID — every existing RLS policy that
-- references it keeps working unchanged (Postgres resolves policies by OID,
-- not by the name text), so none of the ~20 "_full_hod" policies need editing.
-- The name `is_hod()` is then free to be reused for the new read-only role.
-- ============================================================================

alter table teachers rename column is_hod to is_dept_coordinator;

create or replace function is_hod()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from teachers where id = auth.uid() and is_dept_coordinator)
$$;

alter function is_hod() rename to is_dept_coordinator;

alter table teachers add column is_hod boolean not null default false;

create function is_hod()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from teachers where id = auth.uid() and is_hod)
$$;

-- The "cannot be a TG" guard follows the Dept Coordinator role (full-admin
-- conflict of interest), not the new read-only HOD (no conflict — a
-- statistics-only viewer can also hold a TG assignment).
create or replace function reject_hod_as_tg()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from teachers where id = new.tg_teacher_id and is_dept_coordinator) then
    raise exception 'A Dept Coordinator cannot be assigned as a TG (batch %)', new.id;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Read-only statistics access for the new HOD role. SELECT only — no insert/
-- update/delete policy is added anywhere, so this role structurally cannot
-- manipulate data, only read it. `divisions` and `subjects` already have an
-- open `using (true)` select policy for all authenticated teachers, so no
-- additional policy is needed there.
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
