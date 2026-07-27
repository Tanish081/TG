# Teacher Guardian (TG)

Department-level student monitoring for the AI & DS department. See
[PROJECT_SPEC.md](./PROJECT_SPEC.md) for the full design.

Built so far: **Phases 0–3** — schema, RLS, auth, admin, attendance marking, and TG
monitoring (the "assign → mark → monitor" demo loop), plus a read-only department
statistics dashboard. Marks/GPA entry (Phase 4) has a working per-student form on the TG's
student page; bulk CSV upload and promotion/YD (Phase 5) are not built yet.

## Roles

Five role-assignments (a teacher can hold several at once — see PROJECT_SPEC.md §2):

- **Dept Coordinator** (`is_dept_coordinator`) — full manage access: teachers, students,
  subjects, batches, divisions, cohorts. Cannot also be a TG.
- **HOD** (`is_hod`) — read-only department-wide statistics (attendance, GPA, batch/division
  health). Cannot create, edit, or delete anything, anywhere.
- **Class teacher** — owns one division's roster.
- **TG** — monitors one batch (roll-range slice of a division).
- **Subject teacher** — marks attendance for assigned cohorts.

## Stack

React (Vite) + TypeScript + Tailwind + shadcn/ui, Supabase (Postgres/Auth/RLS), react-router,
TanStack Query.

## 1. Create a Supabase project

Create a project at [supabase.com](https://supabase.com), then grab its URL and anon key from
Project Settings → API.

## 2. Configure env vars

```
cp .env.example .env
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## 3. Run the migrations

In the Supabase SQL editor (or via the Supabase CLI once installed), run in order:

1. `supabase/migrations/0001_schema.sql` — tables, `roll_code` generation, triggers
2. `supabase/migrations/0002_rls.sql` — RLS policies + helper functions

On a **fresh** database, that's it — everything below is already folded into those two files.

If your database predates these fixes, run the rest in order too (each is safe to re-run):

3. `supabase/migrations/0003_class_teacher_student_creation.sql`
4. `supabase/migrations/0004_fix_roll_code_order.sql`
5. `supabase/migrations/0005_fix_students_insert_policy.sql`
6. `supabase/migrations/0006_fix_students_select_after_insert.sql`
7. `supabase/migrations/0007_fix_roll_code_format.sql`
8. `supabase/migrations/0008_sync_core_cohort_members.sql`
9. `supabase/migrations/0009_one_teacher_per_cohort.sql`
10. `supabase/migrations/0010_dept_coordinator_and_hod.sql` — splits the old single HOD role
    into Dept Coordinator (full access, renamed) and HOD (new, read-only statistics)

## 4. Deploy the invite-teacher Edge Function

Teacher onboarding needs the service-role key, so it runs as an Edge Function
(`supabase/functions/invite-teacher`, callable by a Dept Coordinator). Once you have the
[Supabase CLI](https://supabase.com/docs/guides/cli) installed and linked to your project:

```
supabase functions deploy invite-teacher
```

Without this, the "Invite teacher" button in admin won't work — everything else in the app
still functions; you can also just create teacher accounts directly via Supabase Studio →
Authentication → Add user.

## 5. Create your first Dept Coordinator account

The app has no public sign-up (students never log in; teachers are invited). To bootstrap the
very first admin:

1. Supabase Studio → Authentication → Add user (email + password), or sign them up any way you like.
2. This fires the `on_auth_user_created` trigger, creating their `teachers` row.
3. Manually flip them to Dept Coordinator:
   ```sql
   update teachers set is_dept_coordinator = true where email = 'you@example.com';
   ```
   (To also/instead grant the read-only HOD statistics role to someone: `update teachers set
   is_hod = true where email = '...'`.)
4. From then on, that Dept Coordinator can invite every other teacher from the app itself.

## 6. (Optional) Seed one test division

`supabase/seed/seed.sql` seeds a division, a TG batch, 15 students, and a core cohort for a demo.
It looks teachers up by email, so create these five accounts first (see step 5), then run the
seed file:

```
coordinator@tg.test
hod@tg.test
classteacher@tg.test
tg@tg.test
subjectteacher@tg.test
```

## 7. Run the app

```
npm install
npm run dev
```

## Notes on design decisions

- The spec's four "open decisions" (§15) were all built using the recommended defaults: attendance
  cards default to present, YD students append at the end of the junior division, resequencing is
  strict 1..N, and unknown-PRN roster rows are skipped and flagged (with one refinement: the class
  teacher's own "Add students" upload *does* create new identities on unknown PRN — see
  `0003_class_teacher_student_creation.sql` — since they're the one actually onboarding a division).
- Bulk/sensitive writes (roster upload, promotion) are RLS-safe for the Dept Coordinator directly;
  per §1, anything needing the service-role key (teacher invites) goes through an Edge Function
  instead.
- A `divisions` table was added beyond the spec's literal schema — it's the anchor a class teacher
  assignment attaches to, since the spec keeps division as plain columns on `student_enrollments`.
- The original spec's single "HOD" role was later split into two (`0010_dept_coordinator_and_hod.sql`):
  Dept Coordinator kept all the original manage permissions under a new name, and a brand-new HOD
  role was added as read-only department statistics only, with no write access anywhere.
