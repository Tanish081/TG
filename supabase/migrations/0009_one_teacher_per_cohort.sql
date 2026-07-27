-- ============================================================================
-- Enforce exactly one subject teacher per cohort. Previously
-- teaching_assignments only had a unique(teacher_id, cohort_id) constraint,
-- which stopped the same teacher being assigned twice but allowed multiple
-- different teachers on one cohort — the HOD admin UI just inserted a new
-- assignment on every "Assign teacher" click instead of replacing the old
-- one, so cohorts could silently accumulate teachers.
--
-- Keeps the most recently created assignment per cohort and drops the rest
-- before adding the constraint, so this is safe to run on data that already
-- has duplicates.
-- ============================================================================

delete from teaching_assignments
where id not in (
  select distinct on (cohort_id) id
  from teaching_assignments
  order by cohort_id, created_at desc, id desc
);

alter table teaching_assignments add constraint teaching_assignments_cohort_id_key unique (cohort_id);
