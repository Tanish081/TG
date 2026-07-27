-- ============================================================================
-- Let class teachers create new student identities.
--
-- Originally (§11) only the HOD could create students, with unknown PRNs on
-- upload skipped and flagged. In practice, a class teacher is the one who
-- receives a division's students for the first time (e.g. incoming SE), and
-- re-routing every unknown PRN through the HOD is unnecessary friction — the
-- class teacher already owns roll numbers for their division (§2).
--
-- `students` has no division column (identity is division-agnostic — §3), so
-- this can't be scoped to "own division" the way enrollments can. Instead it
-- gates on "is a class teacher of *something*": broad enough to unblock the
-- roster-upload flow, while enrollment inserts remain scoped to their own
-- division via the existing enrollments_insert_class_teacher policy.
-- ============================================================================

create policy students_insert_class_teacher on students
  for insert to authenticated
  with check (exists (select 1 from divisions where class_teacher_id = auth.uid()));
