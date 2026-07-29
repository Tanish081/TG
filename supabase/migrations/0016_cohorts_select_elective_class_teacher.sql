-- ============================================================================
-- Fix: a class teacher could never see a brand-new elective cohort to add
-- their first student to it. cohorts_select_class_teacher (0002) requires an
-- existing cohort_members row to key off — but electives start with zero
-- members by design (each class teacher opts their own students in from "My
-- division"), so that policy can never match a fresh elective. Chicken and
-- egg: can't see it to add a member, can't have a member without seeing it.
--
-- Electives aren't scoped to one division by design (any class teacher's
-- students can join any elective), so the fix is a straightforward "any
-- class teacher can see all elective cohorts" grant, not a narrower scope.
--
-- Safe to run more than once.
-- ============================================================================

drop policy if exists cohorts_select_elective_class_teacher on cohorts;

create policy cohorts_select_elective_class_teacher on cohorts
  for select to authenticated
  using (type = 'elective' and is_class_teacher());
