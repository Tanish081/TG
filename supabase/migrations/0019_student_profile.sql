-- ============================================================================
-- Student profile — personal, academic, achievements. Keyed on students.id
-- (the permanent identity), not on any one enrollment or TG, so this data
-- stands even when the TG or academic year changes. Whichever teacher is
-- currently TG for a student (via their active enrollment) can read/edit it.
--
-- Safe to run more than once.
-- ============================================================================

create or replace function is_tg_of_student(p_student_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from student_enrollments se
    where se.student_id = p_student_id and is_tg_of_enrollment(se.id)
  )
$$;

create table if not exists student_profiles (
  student_id       uuid primary key references students (id) on delete cascade,
  date_of_birth    date,
  blood_group      text,
  father_name      text,
  mother_name      text,
  guardian_contact text,
  address          text,
  alt_contact      text,
  updated_by       uuid references teachers (id),
  updated_at       timestamptz not null default now()
);

create table if not exists student_academic_info (
  student_id      uuid primary key references students (id) on delete cascade,
  backlogs_count  integer not null default 0,
  backlogs_notes  text,
  updated_by      uuid references teachers (id),
  updated_at      timestamptz not null default now()
);

create table if not exists student_achievements (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references students (id) on delete cascade,
  category      text not null default 'other' check (category in ('academic', 'extracurricular', 'certification', 'other')),
  title         text not null,
  description   text,
  achieved_date date,
  document_path text,
  created_by    uuid references teachers (id),
  created_at    timestamptz not null default now()
);

create index if not exists idx_student_achievements_student on student_achievements (student_id);

grant select, insert, update, delete on student_profiles, student_academic_info, student_achievements
  to authenticated, service_role;

alter table student_profiles enable row level security;

drop policy if exists student_profiles_full_hod on student_profiles;
create policy student_profiles_full_hod on student_profiles
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

drop policy if exists student_profiles_full_tg on student_profiles;
create policy student_profiles_full_tg on student_profiles
  for all to authenticated
  using (is_tg_of_student(student_id))
  with check (is_tg_of_student(student_id));

alter table student_academic_info enable row level security;

drop policy if exists student_academic_info_full_hod on student_academic_info;
create policy student_academic_info_full_hod on student_academic_info
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

drop policy if exists student_academic_info_full_tg on student_academic_info;
create policy student_academic_info_full_tg on student_academic_info
  for all to authenticated
  using (is_tg_of_student(student_id))
  with check (is_tg_of_student(student_id));

alter table student_achievements enable row level security;

drop policy if exists student_achievements_full_hod on student_achievements;
create policy student_achievements_full_hod on student_achievements
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

drop policy if exists student_achievements_full_tg on student_achievements;
create policy student_achievements_full_tg on student_achievements
  for all to authenticated
  using (is_tg_of_student(student_id))
  with check (is_tg_of_student(student_id));

-- Storage: achievement documents, private bucket, objects stored as
-- {student_id}/{filename}.
insert into storage.buckets (id, name, public)
values ('student-achievements', 'student-achievements', false)
on conflict (id) do nothing;

drop policy if exists student_achievement_docs_hod on storage.objects;
create policy student_achievement_docs_hod on storage.objects
  for all to authenticated
  using (bucket_id = 'student-achievements' and is_dept_coordinator())
  with check (bucket_id = 'student-achievements' and is_dept_coordinator());

drop policy if exists student_achievement_docs_tg on storage.objects;
create policy student_achievement_docs_tg on storage.objects
  for all to authenticated
  using (bucket_id = 'student-achievements' and is_tg_of_student(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'student-achievements' and is_tg_of_student(((storage.foldername(name))[1])::uuid));
