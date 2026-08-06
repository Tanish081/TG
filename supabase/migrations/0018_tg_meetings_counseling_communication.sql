-- ============================================================================
-- TG record-keeping: meetings (whole batch), counseling sessions and
-- communication log (one student each). Everything owned by the TG who
-- created it; Dept Coordinators get full oversight access like everywhere
-- else in the schema.
--
-- Safe to run more than once.
-- ============================================================================

create table if not exists tg_meetings (
  id             uuid primary key default gen_random_uuid(),
  tg_teacher_id  uuid not null references teachers (id),
  batch_id       uuid not null references batches (id) on delete cascade,
  meeting_date   date not null,
  meeting_time   time not null,
  agenda         text not null,
  minutes        text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_tg_meetings_batch on tg_meetings (batch_id);
create index if not exists idx_tg_meetings_teacher on tg_meetings (tg_teacher_id);

create table if not exists tg_meeting_attendance (
  id            uuid primary key default gen_random_uuid(),
  meeting_id    uuid not null references tg_meetings (id) on delete cascade,
  enrollment_id uuid not null references student_enrollments (id) on delete cascade,
  present       boolean not null default true,
  unique (meeting_id, enrollment_id)
);

create table if not exists tg_counseling_sessions (
  id             uuid primary key default gen_random_uuid(),
  tg_teacher_id  uuid not null references teachers (id),
  enrollment_id  uuid not null references student_enrollments (id) on delete cascade,
  session_date   date not null,
  reason         text not null,
  remarks        text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_tg_counseling_enrollment on tg_counseling_sessions (enrollment_id);
create index if not exists idx_tg_counseling_teacher on tg_counseling_sessions (tg_teacher_id);

create table if not exists tg_communications (
  id             uuid primary key default gen_random_uuid(),
  tg_teacher_id  uuid not null references teachers (id),
  enrollment_id  uuid not null references student_enrollments (id) on delete cascade,
  comm_date      date not null,
  mode           text not null default 'call' check (mode in ('call', 'message', 'email', 'in_person', 'other')),
  purpose        text not null,
  result         text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_tg_communications_enrollment on tg_communications (enrollment_id);
create index if not exists idx_tg_communications_teacher on tg_communications (tg_teacher_id);

grant select, insert, update, delete on tg_meetings, tg_meeting_attendance, tg_counseling_sessions, tg_communications
  to authenticated, service_role;

alter table tg_meetings enable row level security;

drop policy if exists tg_meetings_full_hod on tg_meetings;
create policy tg_meetings_full_hod on tg_meetings
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

drop policy if exists tg_meetings_full_tg on tg_meetings;
create policy tg_meetings_full_tg on tg_meetings
  for all to authenticated
  using (tg_teacher_id = auth.uid())
  with check (tg_teacher_id = auth.uid());

alter table tg_meeting_attendance enable row level security;

drop policy if exists tg_meeting_attendance_full_hod on tg_meeting_attendance;
create policy tg_meeting_attendance_full_hod on tg_meeting_attendance
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

drop policy if exists tg_meeting_attendance_full_tg on tg_meeting_attendance;
create policy tg_meeting_attendance_full_tg on tg_meeting_attendance
  for all to authenticated
  using (exists (
    select 1 from tg_meetings m where m.id = tg_meeting_attendance.meeting_id and m.tg_teacher_id = auth.uid()
  ))
  with check (exists (
    select 1 from tg_meetings m where m.id = tg_meeting_attendance.meeting_id and m.tg_teacher_id = auth.uid()
  ));

alter table tg_counseling_sessions enable row level security;

drop policy if exists tg_counseling_full_hod on tg_counseling_sessions;
create policy tg_counseling_full_hod on tg_counseling_sessions
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

drop policy if exists tg_counseling_full_tg on tg_counseling_sessions;
create policy tg_counseling_full_tg on tg_counseling_sessions
  for all to authenticated
  using (tg_teacher_id = auth.uid())
  with check (tg_teacher_id = auth.uid());

alter table tg_communications enable row level security;

drop policy if exists tg_communications_full_hod on tg_communications;
create policy tg_communications_full_hod on tg_communications
  for all to authenticated
  using (is_dept_coordinator())
  with check (is_dept_coordinator());

drop policy if exists tg_communications_full_tg on tg_communications;
create policy tg_communications_full_tg on tg_communications
  for all to authenticated
  using (tg_teacher_id = auth.uid())
  with check (tg_teacher_id = auth.uid());
