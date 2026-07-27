-- ============================================================================
-- Fix: core cohorts only got their division's roster copied into
-- cohort_members once, at creation time. Any student enrolled into that
-- division afterward (e.g. via the class-teacher "Add students" flow) never
-- became a cohort member, so they never showed up on the attendance-marking
-- screen even though they belong to that division's core subjects.
--
-- Fix: give core cohorts a stored division reference, and auto-add new
-- enrollments to any matching core cohort going forward via a trigger.
-- Also backfills both the reference and any already-missing members now.
--
-- Safe to run more than once.
-- ============================================================================

alter table cohorts add column if not exists year_level text check (year_level in ('FE', 'SE', 'TE', 'BE'));
alter table cohorts add column if not exists branch_code text;
alter table cohorts add column if not exists division text;

-- Backfill: infer each core cohort's division from whichever enrollments are
-- already members of it (all members of a core cohort share one division).
update cohorts c
set year_level = inferred.year_level,
    branch_code = inferred.branch_code,
    division = inferred.division
from (
  select distinct on (cm.cohort_id)
    cm.cohort_id, se.year_level, se.branch_code, se.division
  from cohort_members cm
  join student_enrollments se on se.id = cm.enrollment_id
  order by cm.cohort_id, se.id
) inferred
where c.id = inferred.cohort_id
  and c.type = 'core'
  and c.division is null;

-- Backfill: add any enrollment that matches a core cohort's division but
-- isn't yet a member (covers students added after the cohort was created).
insert into cohort_members (cohort_id, enrollment_id)
select c.id, se.id
from cohorts c
join student_enrollments se
  on se.academic_year = c.academic_year
 and se.year_level = c.year_level
 and se.branch_code = c.branch_code
 and se.division = c.division
where c.type = 'core' and c.division is not null
on conflict do nothing;

-- Going forward: auto-add a newly enrolled student to any matching core cohort.
create or replace function sync_cohort_members_on_enrollment()
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

drop trigger if exists trg_sync_cohort_members_on_enrollment on student_enrollments;

create trigger trg_sync_cohort_members_on_enrollment
  after insert on student_enrollments
  for each row execute function sync_cohort_members_on_enrollment();
