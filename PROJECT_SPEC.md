# Teacher Guardian (TG) System — Project Spec

Department-level student monitoring system for the **AI & DS** department. Teachers mark
attendance for the subjects they teach; Teacher Guardians (TGs) monitor the attendance,
marks, and GPA of the students assigned to them.

This document is the **source of truth** for the design. Build against it.

---

## 1. Tech stack

- **Frontend:** React (Vite) + Tailwind CSS + shadcn/ui.
- **Backend / DB:** **Supabase** — Postgres, Auth, Row-Level Security (RLS), Realtime, Storage.
  Supabase replaces both a separate database and most custom backend code.
- **Optional server logic:** Supabase Edge Functions (or a thin Express layer) only for work that
  should not run on the client — e.g. bulk promotion, mark uploads with service-role access.
- **Not used:** MongoDB. The data is relational and depends on RLS, so Postgres is the correct fit.

**Auth:** Supabase email login. Only **teachers and HODs** authenticate. **Students never log in** —
they are data rows only.

---

## 2. Roles (four permission tiers)

Roles are **assignments**, not account types. One teacher can simultaneously be a subject teacher,
a TG, and a class teacher. These are separate assignment rows, not separate logins.

| Role | Scope | Can do |
|------|-------|--------|
| **HOD** | Whole department | Manage teachers, students, subjects. Define batches. Assign class teachers and TGs. Create elective cohorts. May also teach. **Cannot be a TG.** |
| **Class teacher** | One division | See their whole division's progress. **Owns roll numbers** for their division (assign, correct, run promotion/YD renumber). Add their division's students to elective cohorts. |
| **TG (Teacher Guardian)** | One batch (roll-range slice of a division) | Monitor their batch's students across all subjects. **Upload insem/endsem marks and GPA** for their batch. |
| **Subject teacher** | The cohorts they are assigned | **Mark attendance** for those cohorts. Attendance only. |

**HOD-cannot-be-TG** is enforced with (a) a DB trigger rejecting a batch whose `tg_teacher_id`
resolves to an HOD, and (b) the assignment UI only listing teachers.

---

## 3. Identity model — PRN vs roll number

The central design decision. **PRN is permanent; roll number changes every year.** Keeping these on
separate tables is what keeps a student's history correct across years.

### `students` — permanent identity
- `id` (uuid, PK)
- `prn` (text, **unique, permanent**) — the anchor key for all lookups and uploads
- `name`, `email`
- `status` — e.g. `active`, `yd`, `left`

### `student_enrollments` — per-academic-year record
One row per student **per academic year**. Everything that changes yearly lives here.
- `id` (uuid, PK)
- `student_id` (FK → students)
- `academic_year` (e.g. `2025-26`)
- `year_level` — `FE` | `SE` | `TE` | `BE`
- `branch_code` — e.g. `AID`
- `division` — e.g. `A`, `B`
- `roll_seq` (integer) — the sequence number within the division (the `033` in `SEAID2627C033`)
- `roll_code` — the composed full code (see §4)

**Every transactional row (attendance, marks, GPA) references `enrollment_id`, never the raw
student or the roll number.** This is why changing a roll number never corrupts history.

---

## 4. Roll code format

The roll number is a **structured code composed from parts**, not a free-typed string.

```
SE AID 2627 C 033
│  │    │    │ └── roll_seq  (integer sequence within the division, zero-padded to 3 digits)
│  │    │    └──── division (C)
│  │    └───────── academic_year (short form, 2026-27 → 2627)
│  └────────────── branch_code (AID)
└───────────────── year_level (FE/SE/TE/BE)
```

- Store the **parts** as real columns (`year_level`, `academic_year`, `branch_code`, `division`,
  `roll_seq`) and treat `roll_code` as a value composed from them (generated on write or as a
  computed column). `roll_seq` itself is zero-padded to 3 digits in the composed code.
- **Range and sort logic runs on the integer `roll_seq`** — e.g. a TG batch "25–45" is simply
  `roll_seq BETWEEN 25 AND 45`.
- **Display always shows the full `roll_code`.**
- On promotion the code is **regenerated from parts**, never edited as a string — only `roll_seq`
  and `year_level` change; `branch_code` and (new) `academic_year` are uniform for the division.

---

## 5. Divisions vs cohorts

Two separate axes. Keeping them separate is what makes electives work without special-casing.

- **Division** → identity + roll numbers. A student **lives in exactly one** division.
- **Cohort** → teaching + attendance group. A student **sits in many** cohorts.
  - **Core cohort** = exactly one division (everyone in SE-A takes the core subject together).
  - **Elective cohort** = a custom roster pulled from **one or more divisions** (only the students
    who chose that elective).

Attendance is **always marked against a cohort**, uniformly. The teacher never needs to know whether
a cohort is a whole division or a cross-division elective — they open the cohort, the enrolled
students' cards appear, they mark.

### `cohorts`
- `id`, `subject_id` (FK), `academic_year`, `type` (`core` | `elective`), `label`

### `cohort_members`
- `cohort_id` (FK), `enrollment_id` (FK)
- Core cohorts can be auto-populated from a division. Elective cohorts are populated per §9.

---

## 6. Subjects, batches, teaching assignments

### `subjects`
- `id`, `name`, `code`, `year_level`, `semester`

### `batches` (TG groups) — a roll-range slice **within** a division
- `id`, `academic_year`, `year_level`, `division`
- `roll_start`, `roll_end` (integers, against `roll_seq`)
- `tg_teacher_id` (FK → teacher profile; **must not be an HOD**)

### `teaching_assignments` — who teaches / marks which cohort
- `id`, `teacher_id` (FK), `cohort_id` (FK), `academic_year`

---

## 7. Attendance

### `attendance_sessions` — one lecture instance
- `id`, `teacher_id` (FK), `cohort_id` (FK), `subject_id` (FK), `date`, `slot` / `lecture_no`, `topic`

### `attendance_records`
- `id`, `session_id` (FK), `enrollment_id` (FK), `status` (`present` | `absent` | `late`)

**Attendance UI:** student cards show **roll_code (prominent) + name + present/absent toggle**,
sorted by `roll_seq` ascending (reads like a physical roll sheet). PRN may appear in small text.
> **Decision to confirm:** cards default to **all present** (tap to mark absent — faster) vs
> all unmarked. Recommended: **default present**.

---

## 8. Assessments, marks, GPA

Marks are **uploaded by the TG** for their batch (bulk), not by the subject teacher.

### `assessments`
- `id`, `subject_id` (FK), `exam_type` (`insem` | `endsem`), `max_marks`, `semester`, `academic_year`

### `assessment_results`
- `id`, `assessment_id` (FK), `enrollment_id` (FK), `marks`
- Written by the **TG of the student's batch** (RLS-enforced).

### `semester_results` (GPA)
- `id`, `enrollment_id` (FK), `semester`, `sgpa`, `cgpa`, `academic_year`
- TG-entered (same bulk-upload path).

**Mark upload flow:** TG uploads CSV/Excel → parsed client-side (papaparse / SheetJS) → matched by
**PRN or roll_code** → preview with flagged rows → confirm → bulk insert.

---

## 9. Electives — who does what

- **HOD creates** the elective cohort (one canonical row, prevents duplicates).
- **Each class teacher adds their own division's students** to it. RLS ties the action to the
  student's division: a class teacher physically cannot add a student from another division, even to
  a shared elective. HOD can add anyone as a fallback.
- **Subject teacher marks attendance** against the whole cohort as one class.

A student's TG view aggregates attendance across **all** their cohorts (core + elective)
automatically, because every attendance record hangs off `enrollment_id`.

---

## 10. Promotion & Year-Down (YD)

Promotion is **generating next year's `student_enrollments` rows**, never editing rolls in place.
Old rows stay frozen with their attendance/marks intact.

**Run per division, by the class teacher:**
1. Screen shows the current division roster.
2. Class teacher marks which students got **YD** (checkbox).
3. System drops the YD students and **resequences the rest gap-free** — everyone below a removed
   student shifts up one (`roll_seq` recomputed as `1..N`).
4. Year prefix advances (`FE→SE→TE→BE`); `branch_code` and `division` carry over; `academic_year`
   is the new year. New `roll_code` is regenerated from parts.
5. Class teacher reviews and confirms → new enrollment rows written.

**Example:** roll_seq 11 gets a YD in SE. At TE promotion, old `SEAID2627A011` → new `TEAID2627A010`
(everyone below 11 shifts up one).

**YD students** do **not** get a new-year row in their promoting division. They appear in the
**junior division's** promotion list and are numbered by that division's class teacher.
> **Decisions to confirm:**
> - YD student joining a junior division is **appended at the end** of that division's sequence
>   (takes the next available `roll_seq`). Recommended default.
> - Resequencing is **strictly sequential from 1, gap-free**. Recommended default.

---

## 11. New-student / roster upload (HOD)

For seeding a new academic year's rolls in one authoritative pass (also usable for promotion input).

- File: two columns — `prn`, `roll_seq` (or full `roll_code`).
- Dropdowns (chosen once for the whole file): `academic_year`, `year_level`, `division`, `branch_code`.
- Flow: parse client-side → **match each row by PRN** against `students` → preview table (matched /
  unknown-PRN / duplicate rows flagged) → HOD confirms → bulk insert `student_enrollments` rows.
- The student's identity (`students` row) is never touched — only new yearly enrollment rows are added.
> **Decision to confirm:** unknown PRN → **skip and flag** (default), or allow "create new student".
> Recommended: skip-and-flag first, add create-new later.

---

## 12. RLS policy summary

| Table | HOD | Class teacher | TG | Subject teacher |
|-------|-----|---------------|-----|-----------------|
| students / enrollments | full | read + write **own division** (incl. `roll_seq`, promotion) | read own batch | read own cohorts |
| batches | full | read own division | read own batch | — |
| cohorts / cohort_members | full | add members for **own division's** enrollments | read own batch | read assigned |
| attendance_sessions / records | full | read own division | read own batch | **insert/read own cohorts** |
| assessment_results / semester_results | full | read own division | **write own batch** | — |

All "own X" checks resolve against `auth.uid()` (the teacher's profile id).

---

## 13. Key user flows

- **Subject teacher — mark attendance:** login → "My subjects" → pick cohort + date + slot →
  student cards (roll_code, name, toggle) → submit → writes 1 session + N records.
- **TG — monitor:** "My TG group" → student list with attendance %, latest marks, GPA, low-attendance
  flag (<75%) → drill into a student for the full cross-subject breakdown.
- **TG — upload marks:** upload CSV/Excel → match by PRN/roll → preview → confirm.
- **Class teacher — promotion:** open division roster → mark YD → review resequenced list → confirm.
- **HOD — admin:** manage teachers/students/subjects; define batches; assign class teachers & TGs;
  create elective cohorts; department-wide dashboard.

---

## 14. Build roadmap

- **Phase 0 — Setup:** Supabase project, auth, schema, seed one test division.
- **Phase 1 — HOD admin:** CRUD for teachers, students, subjects; batches; class-teacher & TG
  assignments; elective cohort creation.
- **Phase 2 — Attendance:** cohort-based marking with student cards (core loop part 1).
- **Phase 3 — TG monitoring:** per-student dashboard aggregating across cohorts (core loop part 2).
- **Phase 4 — Marks & GPA:** assessments, TG bulk upload, semester results.
- **Phase 5 — Promotion & uploads:** class-teacher promotion/YD flow, HOD roster upload.
- **Phase 6 — Polish:** low-attendance alerts, reports, refinement.

Build **1 → 2 → 3** first — that's the complete demo loop (assign → mark → monitor).

---

## 15. Open decisions (collected)

1. Attendance cards default **present** vs unmarked. → recommend present.
2. YD student in junior division: **append at end** vs insert by rule. → recommend append.
3. Resequencing **strictly 1..N gap-free**. → recommend yes.
4. Unknown PRN on upload: **skip-and-flag** vs create-new. → recommend skip-and-flag first.
