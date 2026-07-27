-- ============================================================================
-- Dummy student identities for testing the roster upload flow.
--
-- Run this in the Supabase SQL editor. It creates 20 student identities
-- (DUMMY001..DUMMY020) with no enrollment yet. Then, in the app:
--   HOD admin -> Students & roster -> Upload roster
--   -> pick any division -> upload dummy_students_roster.csv
-- That CSV matches these same PRNs against roll_seq 1-20, so it will enroll
-- all 20 in one confirm instead of 20 manual "Enroll" clicks.
-- ============================================================================

insert into students (prn, name, email)
select
  'DUMMY' || lpad(i::text, 3, '0'),
  (array['Aarav','Diya','Rohan','Isha','Kabir','Ananya','Vihaan','Myra','Arjun','Saanvi',
         'Aditya','Kiara','Ishaan','Riya','Dev','Anika','Yash','Tara','Karan','Neha'])[i],
  'dummy' || i || '@tg.test'
from generate_series(1, 20) as i
on conflict (prn) do nothing;
