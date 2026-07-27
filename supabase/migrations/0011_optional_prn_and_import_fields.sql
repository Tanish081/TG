-- ============================================================================
-- Make PRN optional and add fields for onboarding sheets that don't have one
-- (e.g. a college's "subject-wise students report" export, which has its own
-- roll-code string, email, and mobile number, but no PRN).
--
-- Safe to run more than once.
-- ============================================================================

alter table students alter column prn drop not null;
alter table students add column if not exists phone text;
alter table students add column if not exists external_roll_no text;

create index if not exists idx_students_external_roll_no on students (external_roll_no);
