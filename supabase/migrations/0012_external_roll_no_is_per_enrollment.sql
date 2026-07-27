-- ============================================================================
-- Move external_roll_no from students (permanent identity) to
-- student_enrollments (per-year record).
--
-- A roll number is inherently a per-year thing in this system — that's the
-- entire point of the PRN-vs-roll-number split (§3/§4). The source file's own
-- roll code (e.g. "TY2526AIDB101") is a roll number, not an identity
-- attribute, so it belongs next to our own generated `roll_code`, not
-- permanently on `students`. This also makes it the thing actually displayed
-- as "the roll" wherever one shows up in the app (falling back to our
-- generated roll_code when a row has no imported one).
--
-- Safe to run more than once.
-- ============================================================================

alter table student_enrollments add column if not exists external_roll_no text;

update student_enrollments se
set external_roll_no = s.external_roll_no
from students s
where s.id = se.student_id
  and s.external_roll_no is not null
  and se.external_roll_no is null;

alter table students drop column if exists external_roll_no;
drop index if exists idx_students_external_roll_no;

create index if not exists idx_enrollments_external_roll_no on student_enrollments (external_roll_no);
