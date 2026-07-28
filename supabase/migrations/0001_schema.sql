-- ============================================================================
-- Teacher Guardian (TG) — Phase 0 schema
-- Implements PROJECT_SPEC.md sections 3, 4, 5, 6, 7, 8.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- teachers — one row per authenticated user (teacher or HOD). 1:1 with auth.users.
--
-- Two distinct roles live here, both granted manually in the DB (never via
-- self-service signup):
--   is_dept_coordinator — full manage access (teachers, students, subjects,
--     batches, divisions, cohorts). Cannot also be a TG (see reject_hod_as_tg).
--   is_hod — read-only department-wide statistics (attendance, GPA, batch/
--     division health). No insert/update/delete access anywhere.
-- ----------------------------------------------------------------------------
create table teachers (
  id                 uuid primary key references auth.users (id) on delete cascade,
  name               text not null,
  email              text not null unique,
  is_dept_coordinator boolean not null default false,
  is_hod             boolean not null default false,
  created_at         timestamptz not null default now()
);

-- Auto-create a teachers row when a new auth user signs up.
-- New users get no elevated role by default; roles are granted manually in the DB.
create function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into teachers (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', new.email), new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ----------------------------------------------------------------------------
-- students — permanent identity (§3)
-- ----------------------------------------------------------------------------
create table students (
  id                uuid primary key default gen_random_uuid(),
  -- Nullable: some colleges' onboarding sheets (e.g. a subject-wise students
  -- report) don't carry a PRN at all. Postgres treats every NULL as distinct
  -- under a UNIQUE constraint, so any number of PRN-less students is fine.
  prn               text unique,
  name              text not null,
  email             text,
  phone             text,
  status            text not null default 'active' check (status in ('active', 'yd', 'left')),
  -- Who inserted this row (e.g. a class teacher onboarding a new student).
  -- Used by RLS to scope pre-enrollment visibility to its own creator —
  -- see students_select_class_teacher_own_new in 0002_rls.sql.
  created_by        uuid references teachers (id),
  created_at        timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- roll_code composition helper (§4) — '2025-26' -> '2526'
-- ----------------------------------------------------------------------------
create function ay_short(ay text)
returns text
language sql
immutable
as $$
  select substring(split_part(ay, '-', 1) from 3 for 2) || split_part(ay, '-', 2)
$$;

-- ----------------------------------------------------------------------------
-- student_enrollments — per-academic-year record (§3, §4)
-- ----------------------------------------------------------------------------
create table student_enrollments (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references students (id) on delete cascade,
  academic_year  text not null,
  year_level     text not null check (year_level in ('FE', 'SE', 'TE', 'BE')),
  branch_code    text not null,
  division       text not null,
  roll_seq       integer not null check (roll_seq > 0),
  roll_code      text generated always as (
    year_level || branch_code || ay_short(academic_year) || division || lpad(roll_seq::text, 3, '0')
  ) stored,
  -- The source system's own roll-code string for this year, kept verbatim
  -- (e.g. "TY2526AIDB101") when this enrollment came from an import that had
  -- one — distinct from our own generated roll_code above. The app displays
  -- this instead of roll_code whenever it's set.
  external_roll_no text,
  created_at     timestamptz not null default now(),
  unique (academic_year, year_level, branch_code, division, roll_seq),
  unique (student_id, academic_year)
);

create index idx_enrollments_division on student_enrollments (academic_year, year_level, branch_code, division);
create index idx_enrollments_student on student_enrollments (student_id);
create index idx_enrollments_external_roll_no on student_enrollments (external_roll_no);

-- ----------------------------------------------------------------------------
-- divisions — assignment anchor for class teachers (extension of §2/§6:
-- the spec keeps division as free-standing parts on student_enrollments;
-- this table exists only to hold the class-teacher assignment itself).
-- ----------------------------------------------------------------------------
create table divisions (
  id               uuid primary key default gen_random_uuid(),
  academic_year    text not null,
  year_level       text not null check (year_level in ('FE', 'SE', 'TE', 'BE')),
  branch_code      text not null,
  division         text not null,
  class_teacher_id uuid references teachers (id),
  created_at       timestamptz not null default now(),
  unique (academic_year, year_level, branch_code, division)
);

-- ----------------------------------------------------------------------------
-- subjects (§6)
-- ----------------------------------------------------------------------------
create table subjects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  code       text not null unique,
  year_level text not null check (year_level in ('FE', 'SE', 'TE', 'BE')),
  semester   integer not null,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- batches — TG groups, a roll-range slice within a division (§6)
-- ----------------------------------------------------------------------------
create table batches (
  id             uuid primary key default gen_random_uuid(),
  academic_year  text not null,
  year_level     text not null check (year_level in ('FE', 'SE', 'TE', 'BE')),
  branch_code    text not null,
  division       text not null,
  roll_start     integer not null,
  roll_end       integer not null check (roll_end >= roll_start),
  tg_teacher_id  uuid not null references teachers (id),
  created_at     timestamptz not null default now()
);

create index idx_batches_tg on batches (tg_teacher_id);
create index idx_batches_division on batches (academic_year, year_level, branch_code, division);

-- Dept-Coordinator-cannot-be-TG (§2, §6) — the full-admin role, not the
-- read-only HOD role (no conflict of interest for a statistics-only viewer).
create function reject_hod_as_tg()
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

create trigger trg_batches_reject_hod_as_tg
  before insert or update of tg_teacher_id on batches
  for each row execute function reject_hod_as_tg();

-- ----------------------------------------------------------------------------
-- cohorts / cohort_members (§5)
-- ----------------------------------------------------------------------------
create table cohorts (
  id            uuid primary key default gen_random_uuid(),
  subject_id    uuid not null references subjects (id) on delete cascade,
  academic_year text not null,
  type          text not null check (type in ('core', 'elective')),
  label         text not null,
  -- Only set for type = 'core': which division this cohort's roster tracks.
  -- Lets newly enrolled students auto-join via the trigger below, instead of
  -- only getting a one-time snapshot at cohort-creation time.
  year_level    text check (year_level in ('FE', 'SE', 'TE', 'BE')),
  branch_code   text,
  division      text,
  created_at    timestamptz not null default now()
);

create index idx_cohorts_subject on cohorts (subject_id);

create table cohort_members (
  cohort_id     uuid not null references cohorts (id) on delete cascade,
  enrollment_id uuid not null references student_enrollments (id) on delete cascade,
  primary key (cohort_id, enrollment_id)
);

create index idx_cohort_members_enrollment on cohort_members (enrollment_id);

-- Auto-add a newly enrolled student to any core cohort matching their
-- division, so membership stays live rather than a one-time snapshot.
create function sync_cohort_members_on_enrollment()
returns trigger
language plpgsql
as $$
begin
  insert into cohort_members (cohort_id, enrollment_id)
  select c.id, new.id
  from cohorts c
  where c.type = 'core'
    and c.academic_year = new.academic_year
    and c.year_level = new.year_level
    and c.branch_code = new.branch_code
    and c.division = new.division
  on conflict do nothing;
  return new;
end;
$$;

create trigger trg_sync_cohort_members_on_enrollment
  after insert on student_enrollments
  for each row execute function sync_cohort_members_on_enrollment();

-- ----------------------------------------------------------------------------
-- teaching_assignments — who teaches / marks which cohort (§6)
-- One teacher per cohort — assigning a new one replaces whoever was there.
-- ----------------------------------------------------------------------------
create table teaching_assignments (
  id            uuid primary key default gen_random_uuid(),
  teacher_id    uuid not null references teachers (id),
  cohort_id     uuid not null references cohorts (id) on delete cascade unique,
  academic_year text not null,
  created_at    timestamptz not null default now()
);

create index idx_teaching_assignments_teacher on teaching_assignments (teacher_id);
create index idx_teaching_assignments_cohort on teaching_assignments (cohort_id);

-- ----------------------------------------------------------------------------
-- attendance (§7)
-- ----------------------------------------------------------------------------
create table attendance_sessions (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references teachers (id),
  cohort_id   uuid not null references cohorts (id) on delete cascade,
  subject_id  uuid not null references subjects (id),
  date        date not null,
  slot        text not null,
  topic       text,
  created_at  timestamptz not null default now()
);

create index idx_attendance_sessions_cohort on attendance_sessions (cohort_id, date);

create table attendance_records (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references attendance_sessions (id) on delete cascade,
  enrollment_id uuid not null references student_enrollments (id) on delete cascade,
  status        text not null check (status in ('present', 'absent', 'late')),
  unique (session_id, enrollment_id)
);

create index idx_attendance_records_enrollment on attendance_records (enrollment_id);

-- ----------------------------------------------------------------------------
-- assessments, marks, GPA (§8)
-- ----------------------------------------------------------------------------
create table assessments (
  id            uuid primary key default gen_random_uuid(),
  subject_id    uuid not null references subjects (id) on delete cascade,
  exam_type     text not null check (exam_type in ('insem', 'endsem')),
  max_marks     numeric not null,
  semester      integer not null,
  academic_year text not null,
  created_at    timestamptz not null default now()
);

create table assessment_results (
  id            uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments (id) on delete cascade,
  enrollment_id uuid not null references student_enrollments (id) on delete cascade,
  marks         numeric not null,
  created_at    timestamptz not null default now(),
  unique (assessment_id, enrollment_id)
);

create index idx_assessment_results_enrollment on assessment_results (enrollment_id);

create table semester_results (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references student_enrollments (id) on delete cascade,
  semester      integer not null,
  sgpa          numeric,
  cgpa          numeric,
  academic_year text not null,
  created_at    timestamptz not null default now(),
  unique (enrollment_id, semester)
);
