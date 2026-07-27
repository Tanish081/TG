-- ============================================================================
-- Seed: one test division (Phase 0 — "seed one test division").
--
-- PREREQUISITE — teachers authenticate via Supabase Auth, so their `teachers`
-- row is only created once they exist as an auth user (see the
-- `on_auth_user_created` trigger in 0001_schema.sql). Before running this
-- seed, create five auth users (Supabase Studio -> Authentication -> Add
-- user, or your own sign-up screen) with these emails:
--
--   coordinator@tg.test
--   hod@tg.test
--   classteacher@tg.test
--   tg@tg.test
--   subjectteacher@tg.test
--
-- Then run this file. It looks teachers up by email, so run order matters:
-- auth users first, then this seed.
-- ============================================================================

-- Promote the two admin-facing accounts (only a human/DBA should ever flip
-- these flags). Dept Coordinator = full manage access; HOD = read-only
-- department-wide statistics (see 0010_dept_coordinator_and_hod.sql).
update teachers set is_dept_coordinator = true where email = 'coordinator@tg.test';
update teachers set is_hod = true where email = 'hod@tg.test';

-- ----------------------------------------------------------------------------
-- Subjects (SE, semester 3, AI & DS)
-- ----------------------------------------------------------------------------
insert into subjects (name, code, year_level, semester) values
  ('Data Structures',            'DS201', 'SE', 3),
  ('Discrete Mathematics',       'DM201', 'SE', 3),
  ('Database Management Systems','DBMS201','SE', 3)
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- Division SE-A, AY 2025-26, branch AID — owned by the class teacher
-- ----------------------------------------------------------------------------
insert into divisions (academic_year, year_level, branch_code, division, class_teacher_id)
select '2025-26', 'SE', 'AID', 'A', id from teachers where email = 'classteacher@tg.test'
on conflict (academic_year, year_level, branch_code, division) do nothing;

-- ----------------------------------------------------------------------------
-- TG batch covering roll 1-15 of SE-A
-- ----------------------------------------------------------------------------
insert into batches (academic_year, year_level, branch_code, division, roll_start, roll_end, tg_teacher_id)
select '2025-26', 'SE', 'AID', 'A', 1, 15, id from teachers where email = 'tg@tg.test';

-- ----------------------------------------------------------------------------
-- 15 students + their SE-A enrollment rows
-- ----------------------------------------------------------------------------
do $$
declare
  i int;
  s_id uuid;
begin
  for i in 1..15 loop
    insert into students (prn, name, email)
    values ('PRN25AID' || lpad(i::text, 3, '0'), 'Student ' || i, 'student' || i || '@tg.test')
    on conflict (prn) do update set name = excluded.name
    returning id into s_id;

    insert into student_enrollments (student_id, academic_year, year_level, branch_code, division, roll_seq)
    values (s_id, '2025-26', 'SE', 'AID', 'A', i)
    on conflict (academic_year, year_level, branch_code, division, roll_seq) do nothing;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Core cohort for Data Structures = the whole of SE-A, taught by the
-- subject teacher account
-- ----------------------------------------------------------------------------
insert into cohorts (subject_id, academic_year, type, label, year_level, branch_code, division)
select id, '2025-26', 'core', 'SE-A Data Structures', 'SE', 'AID', 'A'
from subjects where code = 'DS201';

insert into cohort_members (cohort_id, enrollment_id)
select c.id, se.id
from cohorts c
join student_enrollments se
  on se.academic_year = '2025-26' and se.year_level = 'SE' and se.branch_code = 'AID' and se.division = 'A'
where c.label = 'SE-A Data Structures'
on conflict do nothing;

insert into teaching_assignments (teacher_id, cohort_id, academic_year)
select t.id, c.id, '2025-26'
from teachers t, cohorts c
where t.email = 'subjectteacher@tg.test' and c.label = 'SE-A Data Structures'
on conflict do nothing;
